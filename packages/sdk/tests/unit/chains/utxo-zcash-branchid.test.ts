/**
 * Verifies that the Zcash `branchId` is a build-time parameter (not a
 * hardcoded constant in the sighash). A pre-upgrade vs post-upgrade consumer
 * building the same send should produce DIFFERENT sighashes — that's how
 * we know the branchId is reaching the BLAKE2b personalization path. If it
 * were still hardcoded, both would match.
 */
import { describe, expect, it } from 'vitest'

import { buildUtxoSendTx, ZCASH_BRANCH_ID_NU6_1, ZCASH_BRANCH_ID_NU6_2 } from '../../../src/chains/utxo'

const COMPRESSED_PUBKEY = Uint8Array.from(
  '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'.match(/.{2}/g)!.map(b => parseInt(b, 16))
)

describe('Zcash — branchId parametrization', () => {
  it('keeps the NU6.2 constant available for callers that explicitly need that epoch', () => {
    // Sanity: the exported constant matches the NU6.2 epoch value
    // (https://zips.z.cash/zip-0253) and is little-endian-encoded as
    // `30f33754` into the BLAKE2b personalization.
    expect(ZCASH_BRANCH_ID_NU6_2).toBe(0x5437f330)
  })

  it('throws when branchId is omitted for Zcash', () => {
    const baseArgs = {
      chain: 'Zcash' as const,
      fromAddress: 't1PoLLLwEcVhqMBhk53tANtSepnPXAQJkPM',
      toAddress: 't1PoLLLwEcVhqMBhk53tANtSepnPXAQJkPM',
      amount: 100_000n,
      utxos: [{ hash: 'ff'.repeat(32), index: 0, value: 1_000_000n }],
      feeRate: 1,
      compressedPubKey: COMPRESSED_PUBKEY,
    }
    expect(() => buildUtxoSendTx(baseArgs)).toThrow('zcashBranchId is required')
  })

  it('produces a DIFFERENT sighash when branchId changes (i.e. the parameter actually reaches the personalization)', () => {
    const baseArgs = {
      chain: 'Zcash' as const,
      fromAddress: 't1PoLLLwEcVhqMBhk53tANtSepnPXAQJkPM',
      toAddress: 't1PoLLLwEcVhqMBhk53tANtSepnPXAQJkPM',
      amount: 100_000n,
      utxos: [{ hash: 'ff'.repeat(32), index: 0, value: 1_000_000n }],
      feeRate: 1,
      compressedPubKey: COMPRESSED_PUBKEY,
    }
    const nu6_2 = buildUtxoSendTx({ ...baseArgs, zcashBranchId: ZCASH_BRANCH_ID_NU6_2 })
    const previousEpoch = buildUtxoSendTx({ ...baseArgs, zcashBranchId: ZCASH_BRANCH_ID_NU6_1 })
    expect(nu6_2.signingHashesHex).not.toEqual(previousEpoch.signingHashesHex)
  })

  it('keeps the NU6.1 constant available for callers that explicitly need the previous epoch', () => {
    expect(ZCASH_BRANCH_ID_NU6_1).toBe(0x4dec4df0)
  })
})
