/**
 * Verifies the ZIP-317 conventional-fee floor in `buildUtxoSendTx`. Zcash
 * nodes relay zero "unpaid actions" (5,000 zats per logical action, 10,000
 * minimum), so a size-based fee from a low feeRate must be raised to the
 * floor or the network rejects the broadcast with
 * "tx unpaid action limit exceeded".
 *
 * The builder doesn't expose the computed fee directly, so the floor is
 * observed two ways: the insufficient-funds error (which reports the exact
 * fee) and the funds threshold at which building starts to succeed.
 */
import { describe, expect, it } from 'vitest'

import { buildUtxoSendTx, ZCASH_BRANCH_ID_NU6_2 } from '../../../src/chains/utxo'

const COMPRESSED_PUBKEY = Uint8Array.from(
  '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'.match(/.{2}/g)!.map(b => parseInt(b, 16))
)

const ZCASH_ADDRESS = 't1PoLLLwEcVhqMBhk53tANtSepnPXAQJkPM'

const buildZcashSend = ({
  utxoValues,
  amount,
  feeRate = 1,
}: {
  utxoValues: bigint[]
  amount: bigint
  feeRate?: number
}) =>
  buildUtxoSendTx({
    chain: 'Zcash',
    fromAddress: ZCASH_ADDRESS,
    toAddress: ZCASH_ADDRESS,
    amount,
    utxos: utxoValues.map((value, index) => ({ hash: 'ff'.repeat(32), index, value })),
    feeRate,
    compressedPubKey: COMPRESSED_PUBKEY,
    zcashBranchId: ZCASH_BRANCH_ID_NU6_2,
  })

describe('Zcash — ZIP-317 conventional fee floor', () => {
  it('raises a 1 sat/byte fee to the 10,000 zat floor for a single-input send', () => {
    // size fee would be 238 zats (228 bytes * 1); funds only cover that, not the floor
    expect(() => buildZcashSend({ utxoValues: [105_000n], amount: 100_000n })).toThrowError(/fee=10000\b/)
  })

  it('builds successfully once funds cover the floored fee', () => {
    expect(() => buildZcashSend({ utxoValues: [115_000n], amount: 100_000n })).not.toThrowError()
  })

  it('scales the floor with input count beyond the 2-action grace window', () => {
    // 4 inputs -> 4 logical actions -> 20,000 zat floor (size fee at 1 sat/byte is 678)
    expect(() => buildZcashSend({ utxoValues: [30_000n, 30_000n, 30_000n, 25_000n], amount: 100_000n })).toThrowError(
      /fee=20000\b/
    )
  })

  it('keeps the size-based fee when it already exceeds the floor', () => {
    // 100 sat/byte * 228 bytes = 22,800 > 10,000 floor
    expect(() => buildZcashSend({ utxoValues: [110_000n], amount: 100_000n, feeRate: 100 })).toThrowError(/fee=22800\b/)
  })

  it('does not apply the Zcash floor to other UTXO chains', () => {
    // Same shape on Bitcoin at 1 sat/vbyte: fee is 146 sats, well under 10,000
    expect(() =>
      buildUtxoSendTx({
        chain: 'Bitcoin',
        fromAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        toAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        amount: 100_000n,
        utxos: [{ hash: 'ff'.repeat(32), index: 0, value: 101_000n }],
        feeRate: 1,
        compressedPubKey: COMPRESSED_PUBKEY,
      })
    ).not.toThrowError()
  })
})
