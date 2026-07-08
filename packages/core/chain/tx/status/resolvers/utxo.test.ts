import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryUrl: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

import { UtxoChain } from '../../../Chain'
import { getUtxoTxStatus } from './utxo'

describe('getUtxoTxStatus', () => {
  const hash = 'abc123'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns isKnown:false when Blockchair has no record of the hash at all — verify-by-hash MUST NOT swallow broadcast errors for unknown hashes', async () => {
    // Regression for the false-success bug (VA-88 broadcast-verify audit, 2026-07-08):
    // broadcastUtxoTx/broadcastCardanoTx fall through to verifyBroadcastByHash on an
    // ambiguous submit error (BadInputsUTxO/txn-mempool-conflict/already known). That
    // safety net swallows the error iff getUtxoTxStatus reports status:'pending' AND
    // isKnown !== false. Pre-fix this resolver returned plain `{status:'pending'}` for
    // a hash Blockchair has NEVER seen, so undefined isKnown passed the guard and a
    // genuine broadcast failure (e.g. spent/invalid inputs, tx never reached the
    // network) was reported as success — the app showed a "done" screen with a
    // locally computed hash that had no on-chain counterpart. Mirrors cosmos.ts:15 /
    // evm.ts:52 / polkadot.ts:36 / ripple.ts:25.
    mocks.queryUrl.mockResolvedValue({ data: {} })

    const result = await getUtxoTxStatus({ chain: UtxoChain.Bitcoin, hash })
    expect(result).toEqual({ status: 'pending', isKnown: false })
  })

  it('returns isKnown:false on network/API error', async () => {
    mocks.queryUrl.mockRejectedValue(new Error('network failure'))

    const result = await getUtxoTxStatus({ chain: UtxoChain.Bitcoin, hash })
    expect(result).toEqual({ status: 'pending', isKnown: false })
  })

  it('returns isKnown:true when Blockchair has indexed the hash in the mempool (block_id: -1) — the genuine MPC-race case verify-by-hash SHOULD swallow', async () => {
    mocks.queryUrl.mockResolvedValue({
      data: { [hash]: { transaction: { block_id: -1 } } },
    })

    const result = await getUtxoTxStatus({ chain: UtxoChain.Bitcoin, hash })
    expect(result).toEqual({ status: 'pending', isKnown: true })
  })

  it('returns isKnown:true when Blockchair reports block_id: null (also mempool, per the existing convention)', async () => {
    mocks.queryUrl.mockResolvedValue({
      data: { [hash]: { transaction: { block_id: null } } },
    })

    const result = await getUtxoTxStatus({ chain: UtxoChain.Bitcoin, hash })
    expect(result).toEqual({ status: 'pending', isKnown: true })
  })

  it('returns status:success with receipt when mined', async () => {
    mocks.queryUrl.mockResolvedValue({
      data: { [hash]: { transaction: { block_id: 800000, fee: 1500 } } },
    })

    const result = await getUtxoTxStatus({ chain: UtxoChain.Bitcoin, hash })
    expect(result.status).toBe('success')
    expect(result.receipt).toMatchObject({ feeAmount: BigInt(1500), feeTicker: 'BTC' })
  })

  it('omits receipt when fee is missing on a mined tx', async () => {
    mocks.queryUrl.mockResolvedValue({
      data: { [hash]: { transaction: { block_id: 800000 } } },
    })

    const result = await getUtxoTxStatus({ chain: UtxoChain.Bitcoin, hash })
    expect(result.status).toBe('success')
    expect(result.receipt).toBeUndefined()
  })
})
