import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryUrl: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

import { OtherChain } from '../../../Chain'
import { getPolkadotTxStatus } from './polkadot'

describe('getPolkadotTxStatus', () => {
  const hash = '0xabc123'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns isKnown:false when Subscan does not know the hash — verify-by-hash MUST NOT swallow broadcast errors for unknown hashes', async () => {
    // Regression for the silent-broadcast bug: when `author_submitExtrinsic`
    // is rejected by the node, `broadcastPolkadotTx` falls through to
    // `verifyBroadcastByHash`. That safety net swallows the error iff
    // `getPolkadotTxStatus` reports `status: 'pending'` AND
    // `isKnown !== false`. Pre-fix this resolver returned plain
    // `{ status: 'pending' }`, so undefined `isKnown` passed the guard
    // and a real broadcast failure was reported as success — UI showed
    // a "done" screen with a locally computed hash that had no
    // on-chain counterpart. Mirrors ripple.ts:25 / solana.ts:19.
    mocks.queryUrl.mockResolvedValue({ code: 10001, message: 'Record Not Found', data: null })

    const result = await getPolkadotTxStatus({ chain: OtherChain.Polkadot, hash })
    expect(result).toEqual({ status: 'pending', isKnown: false })
  })

  it('returns isKnown:false on network/API error', async () => {
    mocks.queryUrl.mockRejectedValue(new Error('network failure'))

    const result = await getPolkadotTxStatus({ chain: OtherChain.Polkadot, hash })
    expect(result).toEqual({ status: 'pending', isKnown: false })
  })

  it('returns isKnown:false when response.data is null', async () => {
    mocks.queryUrl.mockResolvedValue({ code: 0, message: 'Success', data: null })

    const result = await getPolkadotTxStatus({ chain: OtherChain.Polkadot, hash })
    expect(result).toEqual({ status: 'pending', isKnown: false })
  })

  it('returns isKnown:true when Subscan has indexed the extrinsic but it is not finalized', async () => {
    // Genuinely in flight — the legitimate peer-race case where the
    // slower device gets a duplicate error from the node. Here verify-
    // by-hash SHOULD swallow that error.
    mocks.queryUrl.mockResolvedValue({
      code: 0,
      message: 'Success',
      data: { hash, success: false, finalized: false },
    })

    const result = await getPolkadotTxStatus({ chain: OtherChain.Polkadot, hash })
    expect(result).toEqual({ status: 'pending', isKnown: true })
  })

  it('returns status:success with receipt when finalized and success', async () => {
    mocks.queryUrl.mockResolvedValue({
      code: 0,
      message: 'Success',
      data: { hash, success: true, finalized: true, fee_used: '125000000' },
    })

    const result = await getPolkadotTxStatus({ chain: OtherChain.Polkadot, hash })
    expect(result.status).toBe('success')
    expect(result.receipt).toMatchObject({
      feeAmount: BigInt(125000000),
      feeTicker: 'DOT',
    })
  })

  it('falls back to fee when fee_used is absent', async () => {
    mocks.queryUrl.mockResolvedValue({
      code: 0,
      message: 'Success',
      data: { hash, success: true, finalized: true, fee: '200000000' },
    })

    const result = await getPolkadotTxStatus({ chain: OtherChain.Polkadot, hash })
    expect(result.receipt).toMatchObject({ feeAmount: BigInt(200000000) })
  })

  it('returns status:error when finalized but not successful', async () => {
    mocks.queryUrl.mockResolvedValue({
      code: 0,
      message: 'Success',
      data: { hash, success: false, finalized: true, fee_used: '125000000' },
    })

    const result = await getPolkadotTxStatus({ chain: OtherChain.Polkadot, hash })
    expect(result.status).toBe('error')
  })

  it('omits receipt when fee fields are missing on a finalized tx', async () => {
    mocks.queryUrl.mockResolvedValue({
      code: 0,
      message: 'Success',
      data: { hash, success: true, finalized: true },
    })

    const result = await getPolkadotTxStatus({ chain: OtherChain.Polkadot, hash })
    expect(result.status).toBe('success')
    expect(result.receipt).toBeUndefined()
  })
})
