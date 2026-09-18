import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { tronRpcUrl } from './config'

type TronBlockHeaderRawData = {
  timestamp: number
  number: number
  version: number
  txTrieRoot: string
  parentHash: string
  witness_address: string
}

type TronBlock = {
  blockID: string
  block_header: {
    raw_data: TronBlockHeaderRawData
  }
}

// Gateways answer some failures with HTTP 200 and a bare error envelope
// (capital-`E` `Error` from TronGrid/java-tron, lowercase from mirror
// gateways) instead of a block. Mirrors `getTronBlockRefs` in the SDK.
type RawTronBlockResponse = {
  blockID?: string
  block_header?: {
    raw_data?: Partial<TronBlockHeaderRawData>
  }
  Error?: string
  error?: string
}

type BlockChainSpecificTron = {
  timestamp: number
  expiration: number
  blockHeaderTimestamp: number
  blockHeaderNumber: number
  blockHeaderVersion: number
  blockHeaderTxTrieRoot: string
  blockHeaderParentHash: string
  blockHeaderWitnessAddress: string
}

type ResolveRefBlockInput = {
  nowNum: number
  refBlockBytesHex: string
  refBlockHashHex: string
}

type GetTronBlockInfoInput = {
  expiration?: number
  timestamp?: number
  refBlockBytesHex?: string
  refBlockHashHex?: string
}

const requiredRawDataFields = [
  'timestamp',
  'number',
  'version',
  'txTrieRoot',
  'parentHash',
  'witness_address',
] as const satisfies readonly (keyof TronBlockHeaderRawData)[]

/**
 * WalletCore derives `ref_block_bytes` / `ref_block_hash` from the header
 * fields returned here, so a missing field must never be defaulted: a zeroed
 * header still signs (spending the full MPC ceremony, including a Fast-Vault
 * server co-sign) and can only fail on broadcast with TAPOS_ERROR.
 */
const assertCompleteTronBlock = (response: RawTronBlockResponse, endpoint: string): TronBlock => {
  const tronError = response.Error ?? response.error
  if (tronError) {
    throw new Error(`${endpoint} failed: ${tronError}`)
  }

  const rawData = response.block_header?.raw_data
  if (!rawData || typeof response.blockID !== 'string') {
    throw new Error(`${endpoint}: response missing block_header.raw_data: ${JSON.stringify(response).slice(0, 200)}`)
  }

  const missing = requiredRawDataFields.filter(field => rawData[field] === undefined || rawData[field] === null)
  if (missing.length > 0) {
    throw new Error(`${endpoint}: block_header.raw_data missing ${missing.join(', ')}`)
  }

  return {
    blockID: response.blockID,
    block_header: { raw_data: rawData as TronBlockHeaderRawData },
  }
}

const getNowBlock = async (): Promise<TronBlock> => {
  const response = await queryUrl<RawTronBlockResponse>(`${tronRpcUrl}/wallet/getnowblock`, {
    body: {},
  })
  return assertCompleteTronBlock(response, 'getnowblock')
}

const getBlockByNum = async (num: number): Promise<TronBlock> => {
  const response = await queryUrl<RawTronBlockResponse>(`${tronRpcUrl}/wallet/getblockbynum`, {
    body: { num },
  })
  return assertCompleteTronBlock(response, 'getblockbynum')
}

const deriveRefBlockHashFromBlockID = (blockID: string): string => {
  const id = blockID.replace(/^0x/, '').toLowerCase()
  return id.substring(16, 32)
}

const resolveRefBlock = async ({ nowNum, refBlockBytesHex, refBlockHashHex }: ResolveRefBlockInput) => {
  const low16 = parseInt(refBlockBytesHex, 16)
  // snap to the most recent block whose (blockNum % 65536) === low16
  let candidate = Math.floor(nowNum / 65536) * 65536 + low16
  if (candidate > nowNum) candidate -= 65536

  // Try a few windows (very rarely more than 1 step is needed)
  for (let k = 0; k < 3; k++) {
    const num = candidate - 65536 * k
    const blk = await getBlockByNum(num)
    const derived = deriveRefBlockHashFromBlockID(blk.blockID)
    if (derived.toLowerCase() === refBlockHashHex.toLowerCase()) {
      return blk
    }
  }
  throw new Error('Could not resolve ref block')
}

export async function getTronBlockInfo({
  expiration,
  timestamp,
  refBlockBytesHex,
  refBlockHashHex,
}: GetTronBlockInfoInput): Promise<BlockChainSpecificTron> {
  let currentBlock = await getNowBlock()
  if (refBlockBytesHex && refBlockHashHex) {
    currentBlock = await resolveRefBlock({
      nowNum: currentBlock.block_header.raw_data.number,
      refBlockBytesHex,
      refBlockHashHex,
    })
  }
  const { raw_data: rawData } = currentBlock.block_header
  const blockHeaderTimestamp = rawData.timestamp
  const oneHourMillis = 60 * 60 * 1000
  expiration = expiration ?? blockHeaderTimestamp + oneHourMillis

  return {
    timestamp: timestamp ?? blockHeaderTimestamp,
    expiration,
    blockHeaderTimestamp,
    blockHeaderNumber: rawData.number,
    blockHeaderVersion: rawData.version,
    blockHeaderTxTrieRoot: rawData.txTrieRoot,
    blockHeaderParentHash: rawData.parentHash,
    blockHeaderWitnessAddress: rawData.witness_address,
  }
}
