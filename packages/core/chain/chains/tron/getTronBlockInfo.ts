import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { tronRpcUrl } from './config'

type TronBlockHeaderData = {
  timestamp: number
  number: number
  version: number
  txTrieRoot: string
  parentHash: string
  witness_address: string
}

type TronBlock = {
  block_header: { raw_data: TronBlockHeaderData }
  blockID?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseTronBlock = (value: unknown): TronBlock => {
  const invalid = (field: string): never => {
    throw new Error(`Invalid Tron block response: ${field}`)
  }
  if (!isRecord(value)) return invalid('expected an object')
  if ('Error' in value || 'error' in value) return invalid('RPC error envelope')
  const header = value.block_header
  if (!isRecord(header) || !isRecord(header.raw_data)) return invalid('missing block_header.raw_data')
  const raw = header.raw_data

  const integer = (field: string, min: number, max = Number.MAX_SAFE_INTEGER): number => {
    const result = raw[field]
    if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < min || result > max) {
      return invalid(`invalid block_header.raw_data.${field}`)
    }
    return result
  }
  const hex = (field: string, pattern: RegExp): string => {
    const result = raw[field]
    if (typeof result !== 'string' || !pattern.test(result)) {
      return invalid(`invalid block_header.raw_data.${field}`)
    }
    return result
  }

  return {
    blockID: value.blockID,
    block_header: {
      raw_data: {
        timestamp: integer('timestamp', 1),
        number: integer('number', 0),
        version: integer('version', 0, 0x7fffffff),
        txTrieRoot: hex('txTrieRoot', /^[a-f0-9]{64}$/i),
        parentHash: hex('parentHash', /^[a-f0-9]{64}$/i),
        witness_address: hex('witness_address', /^41[a-f0-9]{40}$/i),
      },
    },
  }
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

const getBlockByNum = async (num: number) => {
  return parseTronBlock(await queryUrl<unknown>(`${tronRpcUrl}/wallet/getblockbynum`, { body: { num } }))
}

const deriveRefBlockHashFromBlockID = (blockID: unknown): string => {
  if (typeof blockID !== 'string' || !/^(0x)?[a-f0-9]{64}$/i.test(blockID)) {
    throw new Error('Invalid Tron block response: invalid blockID')
  }
  const id = blockID.replace(/^0x/i, '').toLowerCase()
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
  const url = `${tronRpcUrl}/wallet/getnowblock`

  let currentBlock = parseTronBlock(await queryUrl<unknown>(url, { body: {} }))
  if (refBlockBytesHex && refBlockHashHex) {
    currentBlock = await resolveRefBlock({
      nowNum: currentBlock.block_header.raw_data.number,
      refBlockBytesHex,
      refBlockHashHex,
    })
  }
  const raw = currentBlock.block_header.raw_data
  const blockHeaderTimestamp = raw.timestamp
  const oneHourMillis = 60 * 60 * 1000
  expiration = expiration ?? blockHeaderTimestamp + oneHourMillis

  return {
    timestamp: timestamp ?? blockHeaderTimestamp,
    expiration,
    blockHeaderTimestamp,
    blockHeaderNumber: raw.number,
    blockHeaderVersion: raw.version,
    blockHeaderTxTrieRoot: raw.txTrieRoot,
    blockHeaderParentHash: raw.parentHash,
    blockHeaderWitnessAddress: raw.witness_address,
  }
}
