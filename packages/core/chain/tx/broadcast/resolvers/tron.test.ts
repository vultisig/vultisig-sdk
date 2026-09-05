import { OtherChain } from '@vultisig/core-chain/Chain'
import { Buffer } from 'buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { broadcastTx } from '../index'
import { broadcastTronTx } from './tron'

const mocks = vi.hoisted(() => ({
  queryUrl: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

describe('broadcastTronTx', () => {
  const localHash = 'ab'.repeat(32)
  const tx = {
    id: Buffer.from(localHash, 'hex'),
    json: '{}',
  } as never

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the canonical local hash when the node reports the same transaction ID', async () => {
    mocks.queryUrl.mockResolvedValue({ result: true, txid: localHash.toUpperCase() })

    await expect(broadcastTronTx({ chain: OtherChain.Tron, tx })).resolves.toEqual({
      status: 'accepted',
      finality: 'pending',
      txHash: localHash,
    })
  })

  it('fails closed when a successful response omits the transaction ID', async () => {
    mocks.queryUrl.mockResolvedValue({ result: true })

    const result = await broadcastTronTx({ chain: OtherChain.Tron, tx })
    expect(result).toMatchObject({ status: 'failed', retryable: false })
    expect(result.status === 'failed' && result.cause).toBeInstanceOf(Error)
  })

  it('fails closed when the node transaction ID does not match the signed transaction', async () => {
    mocks.queryUrl.mockResolvedValue({ result: true, txid: 'cd'.repeat(32) })

    const result = await broadcastTronTx({ chain: OtherChain.Tron, tx })
    expect(result).toMatchObject({ status: 'failed', retryable: false })
    expect(result.status === 'failed' && String(result.cause)).toContain('mismatched transaction ID')
  })
  afterEach(() => vi.useRealTimers())

  it('does not classify a semantic rejection containing timeout words as transport failure', async () => {
    vi.useFakeTimers()
    mocks.queryUrl.mockResolvedValue({ Error: 'contract rejected: request timed out' })
    const result = broadcastTronTx({ chain: OtherChain.Tron, tx })
    await vi.runAllTimersAsync()
    await expect(result).resolves.toMatchObject({ status: 'failed', retryable: false })
    expect(mocks.queryUrl.mock.calls.filter(([url]) => String(url).endsWith('/broadcasttransaction'))).toHaveLength(1)
  })

  it('does not resubmit through the outer dispatcher when public hash lookup remains unavailable', async () => {
    vi.useFakeTimers()
    mocks.queryUrl.mockRejectedValue(new TypeError('fetch failed'))
    const result = broadcastTx({ chain: OtherChain.Tron, tx })
    await vi.runAllTimersAsync()
    await expect(result).resolves.toMatchObject({ status: 'failed', retryable: true })
    expect(mocks.queryUrl.mock.calls.filter(([url]) => String(url).endsWith('/broadcasttransaction'))).toHaveLength(1)
  })
})
