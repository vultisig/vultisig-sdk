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
  blockID?: unknown
  block_header?: {
    raw_data?: Partial<Record<keyof TronBlockHeaderRawData, unknown>>
  }
  Error?: unknown
  error?: unknown
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

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// Signing converts these with `Buffer.from(value, 'hex')`, which silently
// yields an empty buffer for non-hex input and truncates at the first invalid
// or odd trailing character, so a string that is merely non-empty can still
// reach the ceremony as a malformed TAPOS header. Require bare hex of the
// exact byte length the protocol serialises.
const isHexOfByteLength =
  (byteLength: number) =>
  (value: unknown): value is string =>
    typeof value === 'string' && value.length === byteLength * 2 && /^[0-9a-fA-F]+$/.test(value)

const sha256ByteLength = 32
// 0x41 prefix byte + 20-byte address
const tronAddressByteLength = 21

// Numeric fields must be finite numbers (a string `timestamp` would turn the
// default `expiration` into string concatenation) and identifier fields must
// be well-formed hex (an empty `txTrieRoot` / `parentHash` still signs).
const rawDataFieldValidators: { [K in keyof TronBlockHeaderRawData]: (value: unknown) => boolean } = {
  timestamp: isFiniteNumber,
  number: isFiniteNumber,
  version: isFiniteNumber,
  txTrieRoot: isHexOfByteLength(sha256ByteLength),
  parentHash: isHexOfByteLength(sha256ByteLength),
  witness_address: isHexOfByteLength(tronAddressByteLength),
}

const requiredRawDataFields = Object.keys(rawDataFieldValidators) as (keyof TronBlockHeaderRawData)[]

const describeResponse = (response: unknown) => JSON.stringify(response)?.slice(0, 200) ?? String(response)

/**
 * WalletCore derives `ref_block_bytes` / `ref_block_hash` from the header
 * fields returned here, so a missing field must never be defaulted: a zeroed
 * header still signs (spending the full MPC ceremony, including a Fast-Vault
 * server co-sign) and can only fail on broadcast with TAPOS_ERROR.
 *
 * `queryUrl` only asserts the HTTP status, so `response` is treated as
 * untrusted JSON here: it may be `null`, a primitive, or carry wrong-typed
 * fields, and every one of those must surface as a controlled error.
 */
const assertCompleteTronBlock = (response: RawTronBlockResponse | null | undefined, endpoint: string): TronBlock => {
  if (typeof response !== 'object' || response === null) {
    throw new Error(`${endpoint}: response is not an object: ${describeResponse(response)}`)
  }

  const tronError = response.Error ?? response.error
  if (tronError !== undefined && tronError !== null && tronError !== '') {
    throw new Error(`${endpoint} failed: ${typeof tronError === 'string' ? tronError : describeResponse(tronError)}`)
  }

  const rawData = response.block_header?.raw_data
  if (typeof rawData !== 'object' || rawData === null || !isNonEmptyString(response.blockID)) {
    throw new Error(`${endpoint}: response missing block_header.raw_data: ${describeResponse(response)}`)
  }

  const invalid = requiredRawDataFields.filter(field => !rawDataFieldValidators[field](rawData[field]))
  if (invalid.length > 0) {
    throw new Error(`${endpoint}: block_header.raw_data missing or invalid ${invalid.join(', ')}`)
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
