/**
 * Tron transaction golden-vector byte tests.
 *
 * Gap this fills: `buildTronSendTx` / `buildTrc20TransferTx`
 * (chains/tron/tx.ts + chains/tron/proto.ts) hand-roll a Tron-protocol
 * protobuf encoder from scratch (see the header comment in proto.ts: no
 * `protobufjs`/`@bufbuild/protobuf` dependency, to keep Hermes bundle size
 * down). No test independently re-derives the wire bytes.
 *
 * Why there's no npm reference package: unlike Cosmos-family chains (which
 * have `cosmjs-types`), there is no maintained TypeScript package that
 * publishes Tron's `protocol.Transaction` / `TransferContract` /
 * `TriggerSmartContract` proto bindings (the closest, `tronweb`, bundles its
 * own generated protobuf JS but does not export raw encode/decode
 * primitives for these specific messages in a way that's usable
 * standalone). We flag this as LOWER confidence than the Ripple/Sui/Cosmos
 * vectors in this same PR: there is no second real-world implementation to
 * diff against, only an independent encoding of the SAME documented schema.
 *
 * Strategy: hand-encode using the exact field layout documented in
 * `chains/tron/tx.ts`'s own header comment (which mirrors Tron's published
 * `core/Tron.proto` / `core/contract/balance_contract.proto` /
 * `core/contract/smart_contract.proto`) via `@bufbuild/protobuf`'s audited
 * `BinaryWriter` — a genuinely different wire-format implementation than the
 * SDK's hand-rolled `encodeVarint`/`encodeInt64Varint`/`fieldBytes` helpers
 * in `proto.ts`. This independently exercises the tricky bits (int64 varint
 * encoding, nested length-delimited Any/Contract wrapping, field ordering)
 * using a different codebase, even though the message SHAPE itself is
 * transcribed by hand from the same documented spec on both sides.
 */
import { BinaryWriter, WireType } from '@bufbuild/protobuf/wire'
import { sha256 } from '@noble/hashes/sha2.js'
import bs58check from 'bs58check'
import { describe, expect, it } from 'vitest'

import { buildTrc20CallData, buildTrc20TransferTx, buildTronSendTx } from '../../../../src/chains/tron/tx'

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function decodeTronAddress(address: string): Uint8Array {
  const decode = (bs58check as unknown as { decode: (s: string) => Uint8Array }).decode
  return decode(address)
}

const FX = {
  // Valid base58check Tron addresses (0x41 prefix + fixed 20-byte payload + checksum).
  from: 'TRcvCk5fLxxgRc7KopfPXb3GzUqZMjcKkn',
  to: 'TUjQ4teuAzMbboCGcQqhTc1Wot59fEJnBg',
  tokenAddress: 'TXqsw3E911kWmzHDR121PcykdHJk3owgk5',
  amount: 250_000_000n, // 250 TRX in SUN
  refBlockBytes: new Uint8Array([0x12, 0x34]),
  refBlockHash: new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]),
  expiration: 1_700_000_060_000n,
  timestamp: 1_700_000_000_000n,
  feeLimit: 100_000_000n,
}

function encodeAny(typeUrl: string, value: Uint8Array): Uint8Array {
  const w = new BinaryWriter()
  w.tag(1, WireType.LengthDelimited).string(typeUrl)
  w.tag(2, WireType.LengthDelimited).bytes(value)
  return w.finish()
}

function encodeContract(contractType: number, anyBytes: Uint8Array): Uint8Array {
  const w = new BinaryWriter()
  w.tag(1, WireType.Varint).int32(contractType)
  w.tag(2, WireType.LengthDelimited).bytes(anyBytes)
  return w.finish()
}

function encodeTransferContract(from: Uint8Array, to: Uint8Array, amount: bigint): Uint8Array {
  const w = new BinaryWriter()
  w.tag(1, WireType.LengthDelimited).bytes(from)
  w.tag(2, WireType.LengthDelimited).bytes(to)
  w.tag(3, WireType.Varint).int64(amount)
  return w.finish()
}

function encodeTriggerSmartContract(from: Uint8Array, contract: Uint8Array, data: Uint8Array): Uint8Array {
  const w = new BinaryWriter()
  w.tag(1, WireType.LengthDelimited).bytes(from)
  w.tag(2, WireType.LengthDelimited).bytes(contract)
  w.tag(3, WireType.Varint).int64(0n)
  w.tag(4, WireType.LengthDelimited).bytes(data)
  return w.finish()
}

function encodeRawData(opts: {
  refBlockBytes: Uint8Array
  refBlockHash: Uint8Array
  expiration: bigint
  contractType: number
  contractTypeUrl: string
  contractValue: Uint8Array
  data?: Uint8Array
  timestamp: bigint
  feeLimit?: bigint
}): Uint8Array {
  const anyBytes = encodeAny(opts.contractTypeUrl, opts.contractValue)
  const contractBytes = encodeContract(opts.contractType, anyBytes)

  const w = new BinaryWriter()
  w.tag(1, WireType.LengthDelimited).bytes(opts.refBlockBytes)
  w.tag(4, WireType.LengthDelimited).bytes(opts.refBlockHash)
  w.tag(8, WireType.Varint).int64(opts.expiration)
  // Field 10: `raw_data.data`, the real Tron memo field. Sorts before field 11
  // (contract) in ascending field-number order, matching Tron's own encoder
  // and WalletCore's output (see the cross-check in tron-tx.test.ts).
  if (opts.data && opts.data.length > 0) {
    w.tag(10, WireType.LengthDelimited).bytes(opts.data)
  }
  w.tag(11, WireType.LengthDelimited).bytes(contractBytes)
  w.tag(14, WireType.Varint).int64(opts.timestamp)
  if (opts.feeLimit != null && opts.feeLimit > 0n) {
    w.tag(18, WireType.Varint).int64(opts.feeLimit)
  }
  return w.finish()
}

function encodeTransaction(rawData: Uint8Array, signature: Uint8Array): Uint8Array {
  const w = new BinaryWriter()
  w.tag(1, WireType.LengthDelimited).bytes(rawData)
  w.tag(2, WireType.LengthDelimited).bytes(signature)
  return w.finish()
}

describe('Tron / buildTronSendTx — TransferContract golden vectors', () => {
  it('produces raw_data bytes byte-identical to an independent @bufbuild/protobuf encoding', () => {
    const result = buildTronSendTx({
      from: FX.from,
      to: FX.to,
      amount: FX.amount,
      refBlockBytes: FX.refBlockBytes,
      refBlockHash: FX.refBlockHash,
      expiration: FX.expiration,
      timestamp: FX.timestamp,
    })

    const contractValue = encodeTransferContract(decodeTronAddress(FX.from), decodeTronAddress(FX.to), FX.amount)
    const referenceRawData = encodeRawData({
      refBlockBytes: FX.refBlockBytes,
      refBlockHash: FX.refBlockHash,
      expiration: FX.expiration,
      contractType: 1,
      contractTypeUrl: 'type.googleapis.com/protocol.TransferContract',
      contractValue,
      timestamp: FX.timestamp,
    })

    expect(result.unsignedRawHex).toBe(bytesToHex(referenceRawData))
    expect(result.signingHashHex).toBe(bytesToHex(sha256(referenceRawData)))
  })

  it('embeds the transaction-level memo (field 10) identically to the reference encoding', () => {
    const memo = new TextEncoder().encode('SWAP:THOR.RUNE:thor1abc:0')
    const result = buildTronSendTx({
      from: FX.from,
      to: FX.to,
      amount: FX.amount,
      refBlockBytes: FX.refBlockBytes,
      refBlockHash: FX.refBlockHash,
      expiration: FX.expiration,
      timestamp: FX.timestamp,
      data: memo,
    })

    const contractValue = encodeTransferContract(decodeTronAddress(FX.from), decodeTronAddress(FX.to), FX.amount)
    const referenceRawData = encodeRawData({
      refBlockBytes: FX.refBlockBytes,
      refBlockHash: FX.refBlockHash,
      expiration: FX.expiration,
      contractType: 1,
      contractTypeUrl: 'type.googleapis.com/protocol.TransferContract',
      contractValue,
      data: memo,
      timestamp: FX.timestamp,
    })

    expect(result.unsignedRawHex).toBe(bytesToHex(referenceRawData))
  })

  it('wraps raw_data + signature into the outer Transaction envelope identically to the reference', () => {
    const result = buildTronSendTx({
      from: FX.from,
      to: FX.to,
      amount: FX.amount,
      refBlockBytes: FX.refBlockBytes,
      refBlockHash: FX.refBlockHash,
      expiration: FX.expiration,
      timestamp: FX.timestamp,
    })

    const sig = new Uint8Array(65).fill(0x0a)
    const finalized = result.finalize(bytesToHex(sig))

    const contractValue = encodeTransferContract(decodeTronAddress(FX.from), decodeTronAddress(FX.to), FX.amount)
    const referenceRawData = encodeRawData({
      refBlockBytes: FX.refBlockBytes,
      refBlockHash: FX.refBlockHash,
      expiration: FX.expiration,
      contractType: 1,
      contractTypeUrl: 'type.googleapis.com/protocol.TransferContract',
      contractValue,
      timestamp: FX.timestamp,
    })
    const referenceSignedTx = encodeTransaction(referenceRawData, sig)

    expect(finalized.signedTxHex).toBe(bytesToHex(referenceSignedTx))
  })
})

describe('Tron / buildTrc20TransferTx — TriggerSmartContract golden vectors', () => {
  it('produces raw_data bytes byte-identical to an independent @bufbuild/protobuf encoding', () => {
    const tokenAmount = 1_000_000_000n
    const result = buildTrc20TransferTx({
      from: FX.from,
      to: FX.to,
      tokenAddress: FX.tokenAddress,
      amount: tokenAmount,
      feeLimit: FX.feeLimit,
      refBlockBytes: FX.refBlockBytes,
      refBlockHash: FX.refBlockHash,
      expiration: FX.expiration,
      timestamp: FX.timestamp,
    })

    const callData = buildTrc20CallData(FX.to, tokenAmount)
    const contractValue = encodeTriggerSmartContract(
      decodeTronAddress(FX.from),
      decodeTronAddress(FX.tokenAddress),
      callData
    )
    const referenceRawData = encodeRawData({
      refBlockBytes: FX.refBlockBytes,
      refBlockHash: FX.refBlockHash,
      expiration: FX.expiration,
      contractType: 31,
      contractTypeUrl: 'type.googleapis.com/protocol.TriggerSmartContract',
      contractValue,
      timestamp: FX.timestamp,
      feeLimit: FX.feeLimit,
    })

    expect(result.unsignedRawHex).toBe(bytesToHex(referenceRawData))
    expect(result.signingHashHex).toBe(bytesToHex(sha256(referenceRawData)))
  })

  it('ABI-encodes the ERC-20 transfer selector/recipient/amount identically to hand computation', () => {
    const tokenAmount = 42_000_000n
    const callData = buildTrc20CallData(FX.to, tokenAmount)

    const expectedSelector = 'a9059cbb'
    const toRaw = decodeTronAddress(FX.to)
    const expectedAddrParam = bytesToHex(toRaw.subarray(1)).padStart(64, '0')
    const expectedAmountParam = tokenAmount.toString(16).padStart(64, '0')

    expect(bytesToHex(callData)).toBe(expectedSelector + expectedAddrParam + expectedAmountParam)
  })
})
