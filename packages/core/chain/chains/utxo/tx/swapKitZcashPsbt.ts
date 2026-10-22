import { Chain } from '@vultisig/core-chain/Chain'
import { Buffer } from 'buffer'

import { getP2pkhScriptForAddress, getP2pkhScriptKeyHash } from './p2pkhAddress'
import { verifySwapKitP2pkhSpend } from './swapKitP2pkhSpend'

/** The `SwapKitSwapPayload.txType` iOS and Android stamp on a Zcash PSBT; iOS dispatches on it verbatim. */
export const swapKitZcashPsbtTxType = 'PSBT_ZEC'

export type SwapKitZcashPsbtInput = {
  /** Previous transaction hash in wire (little-endian) order, as WalletCore's `OutPoint.hash` takes it. */
  hash: Buffer
  index: number
  sequence: number
  amount: bigint
  scriptPubKey: Buffer
}

export type SwapKitZcashPsbtOutput = {
  amount: bigint
  scriptPubKey: Buffer
}

export type SwapKitZcashPsbt = {
  inputs: SwapKitZcashPsbtInput[]
  outputs: SwapKitZcashPsbtOutput[]
  locktime: number
}

const psbtMagic = Buffer.from('70736274ff', 'hex')
const psbtGlobalUnsignedTx = '00'
const psbtInputNonWitnessUtxo = '00'
const psbtInputWitnessUtxo = '01'
const psbtInputPartialSig = '02'
const psbtInputSighashType = '03'
const psbtInputFinalScriptSig = '07'
const psbtInputFinalScriptWitness = '08'

/** Overwinter flag (high bit) plus version 4. */
const saplingTxVersion = 0x80000004
const saplingVersionGroupId = 0x892f2085
const sighashAll = 1
const maxZatoshi = 21_000_000n * 100_000_000n
const maxCount = 1024
const maxFieldLength = 1_000_000

const fail = (message: string): never => {
  throw new Error(`SwapKit Zcash PSBT ${message}`)
}

class ByteReader {
  offset = 0

  constructor(private readonly bytes: Buffer) {}

  get atEnd(): boolean {
    return this.offset === this.bytes.length
  }

  take(length: number): Buffer {
    if (length < 0 || this.offset + length > this.bytes.length) {
      return fail('is truncated.')
    }
    const slice = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return slice
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
    if (first === 0xfd) return this.take(2).readUInt16LE(0)
    if (first === 0xfe) return this.uint32()
    return fail('has an oversized CompactSize.')
  }

  varBytes(maxLength: number): Buffer {
    const length = this.compactSize()
    if (length > maxLength) {
      return fail('has an oversized field.')
    }
    return this.take(length)
  }

  /** One BIP-174 key-value map, keyed by the hex of each full key (type byte plus key data). */
  map(): Map<string, Buffer> {
    const entries = new Map<string, Buffer>()
    for (;;) {
      const key = this.varBytes(maxFieldLength)
      if (key.length === 0) {
        return entries
      }
      const value = this.varBytes(maxFieldLength)
      const id = key.toString('hex')
      if (entries.has(id)) {
        return fail('repeats a map key.')
      }
      entries.set(id, value)
    }
  }
}

const hasKeyType = (map: Map<string, Buffer>, type: string): boolean =>
  [...map.keys()].some(key => key.startsWith(type))

type UnsignedSaplingTx = {
  inputs: Omit<SwapKitZcashPsbtInput, 'amount' | 'scriptPubKey'>[]
  outputs: SwapKitZcashPsbtOutput[]
  locktime: number
}

/**
 * The transparent-only Sapling v4 body SwapKit wraps in the PSBT. NU5 (v5)
 * transactions use the ZIP-244 digest WalletCore does not sign, and shielded
 * components cannot be signed with MPC, so both are refused; so is a non-zero
 * expiry height, which WalletCore cannot reproduce in the transaction it
 * rebuilds from the frozen plan.
 */
const parseUnsignedSaplingTx = (bytes: Buffer): UnsignedSaplingTx => {
  const reader = new ByteReader(bytes)
  const version = reader.uint32()
  const versionGroupId = reader.uint32()
  if (version !== saplingTxVersion || versionGroupId !== saplingVersionGroupId) {
    return fail(
      `transaction version 0x${version.toString(16)} / group 0x${versionGroupId.toString(16)} is unsupported; only transparent Sapling v4 is.`
    )
  }

  const inputCount = reader.compactSize()
  if (inputCount === 0 || inputCount > maxCount) {
    return fail(`has an invalid input count ${inputCount}.`)
  }
  const outpoints = new Set<string>()
  const inputs = Array.from({ length: inputCount }, (_, index) => {
    const hash = Buffer.from(reader.take(32))
    const outpointIndex = reader.uint32()
    const outpoint = `${hash.toString('hex')}:${outpointIndex}`
    if (outpoints.has(outpoint)) {
      return fail(`input #${index} repeats an outpoint.`)
    }
    outpoints.add(outpoint)
    if (reader.varBytes(maxFieldLength).length !== 0) {
      return fail(`input #${index} already carries a scriptSig.`)
    }
    return { hash, index: outpointIndex, sequence: reader.uint32() }
  })

  const outputCount = reader.compactSize()
  if (outputCount === 0 || outputCount > maxCount) {
    return fail(`has an invalid output count ${outputCount}.`)
  }
  const outputs = Array.from({ length: outputCount }, (_, index) => {
    const amount = reader.uint64()
    if (amount > maxZatoshi) {
      return fail(`output #${index} exceeds the Zcash supply.`)
    }
    return { amount, scriptPubKey: Buffer.from(reader.varBytes(maxFieldLength)) }
  })

  const locktime = reader.uint32()
  const expiryHeight = reader.uint32()
  if (expiryHeight !== 0) {
    return fail(`expiry height ${expiryHeight} is unsupported; the rebuilt transaction cannot carry one.`)
  }
  const valueBalance = reader.uint64()
  const shieldedSpends = reader.compactSize()
  const shieldedOutputs = reader.compactSize()
  const joinSplits = reader.compactSize()
  if (valueBalance !== 0n || shieldedSpends !== 0 || shieldedOutputs !== 0 || joinSplits !== 0) {
    return fail('carries shielded components; only transparent transactions can be signed.')
  }
  if (!reader.atEnd) {
    return fail('transaction has trailing bytes.')
  }

  return { inputs, outputs, locktime }
}

const parseWitnessUtxo = (bytes: Buffer, index: number): Pick<SwapKitZcashPsbtInput, 'amount' | 'scriptPubKey'> => {
  const reader = new ByteReader(bytes)
  const amount = reader.uint64()
  if (amount > maxZatoshi) {
    return fail(`input #${index} amount exceeds the Zcash supply.`)
  }
  const scriptPubKey = Buffer.from(reader.varBytes(maxFieldLength))
  if (!reader.atEnd) {
    return fail(`input #${index} WITNESS_UTXO has trailing bytes.`)
  }
  return { amount, scriptPubKey }
}

/**
 * Parses SwapKit's Zcash PSBT: a BIP-174 envelope around a transparent-only
 * Sapling v4 transaction, which bitcoinjs-lib cannot read. Every input must
 * carry a `WITNESS_UTXO` (the shape SwapKit ships, and the one iOS accepts);
 * ZIP-243 commits each input's amount and script to the digest, so a wrong
 * value there can only produce a signature the network rejects. Inputs that
 * are already signed or finalized are refused.
 */
export const parseSwapKitZcashPsbt = (psbtBytes: Uint8Array): SwapKitZcashPsbt => {
  if (psbtBytes.length === 0) {
    return fail('payload is empty.')
  }
  const reader = new ByteReader(Buffer.from(psbtBytes))
  if (!reader.take(psbtMagic.length).equals(psbtMagic)) {
    return fail('magic bytes are invalid.')
  }

  const globals = reader.map()
  const unsignedTx = globals.get(psbtGlobalUnsignedTx)
  if (!unsignedTx) {
    return fail('is missing its unsigned transaction.')
  }
  const tx = parseUnsignedSaplingTx(unsignedTx)

  const inputs = tx.inputs.map((input, index) => {
    const map = reader.map()
    if (
      hasKeyType(map, psbtInputPartialSig) ||
      map.has(psbtInputFinalScriptSig) ||
      map.has(psbtInputFinalScriptWitness)
    ) {
      return fail(`input #${index} is already signed or finalized.`)
    }
    const sighashType = map.get(psbtInputSighashType)
    if (sighashType && (sighashType.length !== 4 || sighashType.readUInt32LE(0) !== sighashAll)) {
      return fail(`input #${index} requests an unsupported sighash type.`)
    }
    const witnessUtxo = map.get(psbtInputWitnessUtxo)
    if (!witnessUtxo) {
      return fail(
        map.has(psbtInputNonWitnessUtxo)
          ? `input #${index} carries only a full previous transaction; a WITNESS_UTXO is required.`
          : `input #${index} is missing its WITNESS_UTXO.`
      )
    }
    return { ...input, ...parseWitnessUtxo(witnessUtxo, index) }
  })

  tx.outputs.forEach(() => reader.map())
  if (!reader.atEnd) {
    return fail('has trailing bytes.')
  }

  return { inputs, outputs: tx.outputs, locktime: tx.locktime }
}

type VerifySwapKitZcashPsbtInput = {
  tx: SwapKitZcashPsbt
  /** The vault's own transparent address; every input must spend from it. */
  senderAddress: string
  /** The quoted sell amount, in zatoshi. */
  fromAmount: string | bigint
}

/**
 * Binds a parsed Zcash PSBT to the vault and the quote: every input spends
 * the vault's own P2PKH script, every output is P2PKH, and the value leaving
 * the vault and the fee stay within the quoted amount. Returns the deposit
 * (the value leaving the vault) and the vault's script.
 */
export const verifySwapKitZcashPsbt = ({ tx, senderAddress, fromAmount }: VerifySwapKitZcashPsbtInput) => {
  const senderScript = getP2pkhScriptForAddress({ chain: Chain.Zcash, address: senderAddress })

  tx.inputs.forEach(({ scriptPubKey }, index) => {
    if (!scriptPubKey.equals(senderScript)) {
      fail(`input #${index} does not spend from this vault's address ${senderAddress}.`)
    }
  })
  tx.outputs.forEach(({ scriptPubKey }, index) => {
    if (!getP2pkhScriptKeyHash(scriptPubKey)) {
      fail(`output #${index} is not a P2PKH output: ${scriptPubKey.toString('hex')}`)
    }
  })

  const deposit = verifySwapKitP2pkhSpend({
    chain: Chain.Zcash,
    inputAmounts: tx.inputs.map(({ amount }) => amount),
    outputs: tx.outputs.map(({ amount, scriptPubKey }) => ({ amount, isChange: scriptPubKey.equals(senderScript) })),
    fromAmount,
  })

  return { deposit, senderScript }
}
