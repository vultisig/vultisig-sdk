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

  it('returns not_found when Blockchair successfully answers but has no record of the hash', async () => {
    // A successful empty lookup is different from a transport failure: the provider answered
    // and said the hash is absent. Surface that as a real miss so CLI callers do not turn a
    // typo or dropped tx into a misleading forever-pending result.
    mocks.queryUrl.mockResolvedValue({ data: {} })

    const result = await getUtxoTxStatus({ chain: UtxoChain.Bitcoin, hash })
    expect(result).toEqual({ status: 'not_found', isKnown: false })
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
