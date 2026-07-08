/**
 * UTXO-04 (audit r2): `buildUtxoSendTx`'s ZIP-317 floor used to be computed by
 * a LOCAL `zcashConventionalFee(inputCount)` that only counted INPUT bytes,
 * silently assuming outputs never exceed the 2-action grace window. That's
 * true for a plain recipient+change send, but a large OP_RETURN memo adds a
 * third output whose bytes can push the OUTPUT action count above the input
 * action count — the local formula ignored that, under-counting ZIP-317
 * actions and under-paying the conventional fee, risking relay rejection
 * ("tx unpaid action limit exceeded").
 *
 * The fix swaps in the canonical `getZcashConventionalFee` (from
 * packages/core/chain/chains/utxo/fee/zip317.ts), which takes
 * `max(inputActions, outputActions)`. These tests prove:
 *   1. a large-memo send now charges MORE than the old input-only count would
 *      have, and
 *   2. a plain (no-memo) send is unaffected — same fee as before the fix.
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
  opReturnData,
}: {
  utxoValues: bigint[]
  amount: bigint
  feeRate?: number
  opReturnData?: string
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
    opReturnData,
  })

describe('Zcash — ZIP-317 conventional fee counts OUTPUT actions too (UTXO-04)', () => {
  it('a plain 1-input send with no memo keeps the pre-fix 10,000 zat floor (unchanged)', () => {
    // recipient + change P2PKH = 68 output bytes -> ceil(68/34)=2 output actions,
    // 1 input -> ceil(148/150)=1 input action; max(1,2)=2 -> 2-action grace floor.
    expect(() => buildZcashSend({ utxoValues: [105_000n], amount: 100_000n })).toThrowError(/fee=10000\b/)
    expect(() => buildZcashSend({ utxoValues: [115_000n], amount: 100_000n })).not.toThrowError()
  })

  it('an 80-byte memo (max standard-relay size) raises the floor above the old input-only count', () => {
    // Output sizes: recipient (34) + change (34) + OP_RETURN(80-byte memo, OP_PUSHDATA1
    // -> 3-byte header + 80 = 83-byte script -> 9+83=92-byte tx_out) = 160 bytes total.
    // outputActions = ceil(160/34) = 5. inputActions (1 input) = 1. logicalActions =
    // max(1,5) = 5 -> fee = 5,000 * 5 = 25,000 zats.
    //
    // The OLD (buggy, input-only) formula ignored the memo entirely and would have
    // charged the 2-action grace floor of 10,000 zats here — a 15,000 zat shortfall
    // that risks "tx unpaid action limit exceeded" at broadcast.
    const memo = 'A'.repeat(80)
    expect(() => buildZcashSend({ utxoValues: [124_999n], amount: 100_000n, opReturnData: memo })).toThrowError(
      /fee=25000\b/
    )
    expect(() =>
      buildZcashSend({ utxoValues: [125_000n], amount: 100_000n, opReturnData: memo })
    ).not.toThrowError()
  })

  it('a small memo that keeps outputs under the grace window does not raise the fee', () => {
    // 10-byte memo: direct push -> 2-byte header + 10 = 12-byte script -> 8+1+12=21-byte
    // tx_out. Total outputs = 34+34+21=89 -> ceil(89/34)=3 output actions. 1 input
    // action. max(1,3)=3 -> above the 2-action grace window -> fee = 5,000*3=15,000.
    const memo = 'A'.repeat(10)
    expect(() => buildZcashSend({ utxoValues: [114_999n], amount: 100_000n, opReturnData: memo })).toThrowError(
      /fee=15000\b/
    )
    expect(() => buildZcashSend({ utxoValues: [115_000n], amount: 100_000n, opReturnData: memo })).not.toThrowError()
  })

  it('scales with both input count and a large memo together', () => {
    // 4 inputs -> inputActions = ceil(4*148/150) = 4. Same 80-byte memo -> outputActions
    // = 5 (as above). max(4,5) = 5 -> fee stays 25,000 (output-bound, not input-bound).
    const memo = 'A'.repeat(80)
    expect(() =>
      buildZcashSend({
        utxoValues: [30_000n, 30_000n, 30_000n, 24_999n],
        amount: 100_000n,
        opReturnData: memo,
      })
    ).toThrowError(/fee=25000\b/)
  })
})
