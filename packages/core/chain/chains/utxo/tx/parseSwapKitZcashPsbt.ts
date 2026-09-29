import { sha256 } from '@noble/hashes/sha2.js'
import { rootApiUrl } from '@vultisig/core-config'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { Buffer } from 'buffer'

type ZcashPsbtInput = {
  hash: Buffer // Wire-order previous transaction hash
  index: number
  sequence: number
  amount: bigint
  scriptPubKey: Buffer
}

type ZcashPsbtOutput = { amount: bigint; scriptPubKey: Buffer }
const maxZcashAmount = 2_100_000_000_000_000n

export type SwapKitZcashPsbt = {
  inputs: ZcashPsbtInput[]
  outputs: ZcashPsbtOutput[]
  locktime: number
}

class Cursor {
  offset = 0
  constructor(readonly bytes: Buffer) {}

  take(length: number): Buffer {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length) {
      throw new Error('SwapKit Zcash PSBT is truncated or oversized')
    }
    const result = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return result
  }

  uint32(): number {
    return this.take(4).readUInt32LE(0)
  }
  uint64(): bigint {
    return this.take(8).readBigUInt64LE(0)
  }

  compactSize(): number {
    const first = this.take(1)[0]
    if (first < 0xfd) return first
    if (first === 0xfd) {
      const value = this.take(2).readUInt16LE(0)
      if (value < 0xfd) throw new Error('Non-canonical PSBT CompactSize')
      return value
    }
    if (first === 0xfe) {
      const value = this.uint32()
      if (value <= 0xffff) throw new Error('Non-canonical PSBT CompactSize')
      return value
    }
    throw new Error('Oversized PSBT CompactSize')
  }

  variable(max: number): Buffer {
    const length = this.compactSize()
    if (length > max) throw new Error('Oversized SwapKit Zcash PSBT field')
    return this.take(length)
  }

  map(): Map<string, Buffer> {
    const result = new Map<string, Buffer>()
    for (;;) {
      const key = this.variable(1024)
      if (key.length === 0) break
      const value = this.variable(1_000_000)
      const id = key.toString('hex')
      if (result.has(id)) throw new Error('Duplicate SwapKit Zcash PSBT key')
      result.set(id, value)
    }
    return result
  }
}

const parseUnsignedSapling = (bytes: Buffer) => {
  const cursor = new Cursor(bytes)
  const version = cursor.uint32()
  const group = cursor.uint32()
  if (version !== 0x80000004 || group !== 0x892f2085) {
    throw new Error('SwapKit Zcash PSBT requires transparent Sapling v4')
  }
  const inputCount = cursor.compactSize()
  if (inputCount === 0 || inputCount > 128) throw new Error('Invalid SwapKit Zcash PSBT input count')
  const inputs = Array.from({ length: inputCount }, () => {
    const hash = cursor.take(32)
    const index = cursor.uint32()
    if (cursor.variable(10_000).length) throw new Error('SwapKit Zcash unsigned transaction has a scriptSig')
    const sequence = cursor.uint32()
    return { hash, index, sequence }
  })
  const outputCount = cursor.compactSize()
  if (outputCount === 0 || outputCount > 32) throw new Error('Invalid SwapKit Zcash PSBT output count')
  const outputs = Array.from({ length: outputCount }, () => ({
    amount: cursor.uint64(),
    scriptPubKey: cursor.variable(10_000),
  }))
  if (outputs.some(output => output.amount > maxZcashAmount)) {
    throw new Error('SwapKit Zcash PSBT output amount exceeds maximum supply')
  }
  const locktime = cursor.uint32()
  const expiryHeight = cursor.uint32()
  const valueBalance = cursor.uint64()
  if (
    expiryHeight !== 0 ||
    valueBalance !== 0n ||
    cursor.compactSize() !== 0 ||
    cursor.compactSize() !== 0 ||
    cursor.compactSize() !== 0 ||
    cursor.offset !== bytes.length
  ) {
    throw new Error('SwapKit Zcash PSBT has unsupported expiry, shielded fields, or trailing data')
  }
  return { inputs, outputs, locktime }
}

/** Parse SwapKit's BIP-174 envelope containing a transparent Sapling-v4 transaction. */
export const parseSwapKitZcashPsbt = (bytes: Uint8Array): SwapKitZcashPsbt => {
  const cursor = new Cursor(Buffer.from(bytes))
  if (cursor.take(5).toString('hex') !== '70736274ff') throw new Error('Invalid SwapKit Zcash PSBT magic')
  const globals = cursor.map()
  const unsigned = globals.get('00')
  if (!unsigned) throw new Error('SwapKit Zcash PSBT is missing its unsigned transaction')
  const tx = parseUnsignedSapling(unsigned)
  const inputs = tx.inputs.map((input, index) => {
    const map = cursor.map()
    if (map.has('03') && (map.get('03')?.length !== 4 || map.get('03')?.readUInt32LE(0) !== 1)) {
      throw new Error(`SwapKit Zcash PSBT input #${index} has unsupported sighash type`)
    }
    if (map.has('00'))
      throw new Error(`SwapKit Zcash PSBT input #${index} requires verified previous-transaction parsing`)
    if ([...map.keys()].some(key => key.startsWith('02') || key === '07' || key === '08')) {
      throw new Error(`SwapKit Zcash PSBT input #${index} is already partially signed or finalized`)
    }
    const witness = map.get('01')
    if (!witness) throw new Error(`SwapKit Zcash PSBT input #${index} is missing UTXO data`)
    const utxo = new Cursor(witness)
    const amount = utxo.uint64()
    if (amount > maxZcashAmount) throw new Error(`SwapKit Zcash PSBT input #${index} amount exceeds maximum supply`)
    const scriptPubKey = utxo.variable(10_000)
    if (utxo.offset !== witness.length) throw new Error(`SwapKit Zcash PSBT input #${index} has trailing UTXO data`)
    return { ...input, amount, scriptPubKey }
  })
  tx.outputs.forEach(() => cursor.map())
  if (cursor.offset !== cursor.bytes.length) throw new Error('SwapKit Zcash PSBT has trailing maps')
  return { inputs, outputs: tx.outputs, locktime: tx.locktime }
}

type ZcashRawTransactionResponse = {
  result?: {
    txid?: string
    hex?: string
    in_active_chain?: boolean
  }
  error?: { message?: string } | null
}

/** Parse authenticated transparent outputs from a full Sapling-v4 previous transaction. */
const parsePreviousSaplingOutputs = (raw: Buffer): ZcashPsbtOutput[] => {
  const cursor = new Cursor(raw)
  if (cursor.uint32() !== 0x80000004 || cursor.uint32() !== 0x892f2085) {
    throw new Error('SwapKit Zcash previous transaction is not Sapling v4')
  }
  const inputCount = cursor.compactSize()
  if (inputCount > 128) throw new Error('SwapKit Zcash previous transaction has too many inputs')
  for (let i = 0; i < inputCount; i++) {
    cursor.take(32)
    cursor.uint32()
    cursor.variable(10_000)
    cursor.uint32()
  }
  const outputCount = cursor.compactSize()
  if (outputCount > 128) throw new Error('SwapKit Zcash previous transaction has too many outputs')
  return Array.from({ length: outputCount }, () => ({
    amount: cursor.uint64(),
    scriptPubKey: cursor.variable(10_000),
  }))
}

/** Verify witness UTXOs against full previous transactions from the Zcash node. */
export const verifySwapKitZcashPrevouts = async (tx: SwapKitZcashPsbt): Promise<void> => {
  await Promise.all(
    tx.inputs.map(async (input, index) => {
      const txid = Buffer.from(input.hash).reverse().toString('hex')
      const response = await queryUrl<ZcashRawTransactionResponse>(`${rootApiUrl}/zcash/`, {
        body: { jsonrpc: '1.0', id: 'vultisig-sdk-swapkit-prevout', method: 'getrawtransaction', params: [txid, 1] },
        timeoutMs: 10_000,
      })
      if (response.error) throw new Error(`SwapKit Zcash previous transaction #${index} lookup failed`)
      const previous = response.result
      const rawHex = previous?.hex
      if (!rawHex || rawHex.length > 2_000_000 || !/^(?:[0-9a-f]{2})+$/iu.test(rawHex)) {
        throw new Error(`SwapKit Zcash previous transaction #${index} is missing valid raw bytes`)
      }
      const raw = Buffer.from(rawHex, 'hex')
      const rawTxid = Buffer.from(sha256(sha256(raw)))
        .reverse()
        .toString('hex')
      const output = parsePreviousSaplingOutputs(raw)[input.index]
      if (
        previous?.txid?.toLowerCase() !== txid ||
        rawTxid !== txid ||
        previous.in_active_chain === false ||
        !output ||
        output.amount !== input.amount ||
        !output.scriptPubKey.equals(input.scriptPubKey)
      ) {
        throw new Error(`SwapKit Zcash PSBT input #${index} does not match its full previous-transaction prevout`)
      }
    })
  )
}
