/**
 * Verifies that the Zcash `branchId` is a build-time parameter (not a
 * hardcoded constant in the sighash). A pre-upgrade vs post-upgrade consumer
 * building the same send should produce DIFFERENT sighashes — that's how
 * we know the branchId is reaching the BLAKE2b personalization path. If it
 * were still hardcoded, both would match.
 */
import { describe, expect, it } from 'vitest'

import { buildUtxoSendTx, ZCASH_BRANCH_ID_NU6_1 } from '../../../src/chains/utxo'

const COMPRESSED_PUBKEY = Uint8Array.from(
  '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'.match(/.{2}/g)!.map(b =>
    parseInt(b, 16)
  )
)

describe('Zcash — branchId parametrization', () => {
  it('defaults to the NU6.1 constant when `zcashBranchId` is omitted', () => {
    // Sanity: the exported constant matches the NU6.1 epoch value
    // (https://zips.z.cash/zip-0253) and is little-endian-encoded as
    // `f04dec4d` into the BLAKE2b personalization.
    expect(ZCASH_BRANCH_ID_NU6_1).toBe(0x4dec4df0)
  })

  it('produces the same sighash when branchId is omitted vs explicitly set to the default', () => {
    const baseArgs = {
      chain: 'Zcash' as const,
      fromAddress: 't1PoLLLwEcVhqMBhk53tANtSepnPXAQJkPM',
      toAddress: 't1PoLLLwEcVhqMBhk53tANtSepnPXAQJkPM',
      amount: 100_000n,
      utxos: [
        { hash: 'ff'.repeat(32), index: 0, value: 1_000_000n },
      ],
      feeRate: 1,
      compressedPubKey: COMPRESSED_PUBKEY,
    }
    const defaultBuilder = buildUtxoSendTx(baseArgs)
    const explicitBuilder = buildUtxoSendTx({ ...baseArgs, zcashBranchId: ZCASH_BRANCH_ID_NU6_1 })
    expect(defaultBuilder.signingHashesHex).toEqual(explicitBuilder.signingHashesHex)
  })

  it('produces a DIFFERENT sighash when branchId changes (i.e. the parameter actually reaches the personalization)', () => {
    const baseArgs = {
      chain: 'Zcash' as const,
      fromAddress: 't1PoLLLwEcVhqMBhk53tANtSepnPXAQJkPM',
      toAddress: 't1PoLLLwEcVhqMBhk53tANtSepnPXAQJkPM',
      amount: 100_000n,
      utxos: [
        { hash: 'ff'.repeat(32), index: 0, value: 1_000_000n },
      ],
      feeRate: 1,
      compressedPubKey: COMPRESSED_PUBKEY,
    }
    const nu6_1 = buildUtxoSendTx(baseArgs)
    // Arbitrary non-NU6.1 branch id — simulates a hypothetical future epoch.
    const futureEpoch = buildUtxoSendTx({ ...baseArgs, zcashBranchId: 0x12345678 })
    expect(nu6_1.signingHashesHex).not.toEqual(futureEpoch.signingHashesHex)
  })
})
