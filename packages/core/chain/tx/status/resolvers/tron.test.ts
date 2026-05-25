import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryUrl: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

import { OtherChain } from '../../../Chain'
import { getTronTxStatus } from './tron'

describe('getTronTxStatus', () => {
  const hash = 'abc123'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns pending when tx has no blockNumber (not yet mined)', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result).toEqual({ status: 'pending' })
  })

  it('returns pending when blockNumber is 0', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 0 })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result).toEqual({ status: 'pending' })
  })

  it('returns pending when receipt is absent (mined but receipt object missing)', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345 })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result).toEqual({ status: 'pending' })
  })

  it('returns success when receipt is present but result is absent', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: {}, fee: 1000000 })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('success')
    expect(result.receipt).toMatchObject({ feeAmount: BigInt(1000000) })
  })

  it('returns error for FAILED', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: { result: 'FAILED' } })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('error')
  })

  it('returns error for OUT_OF_ENERGY (not only FAILED)', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: { result: 'OUT_OF_ENERGY' } })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('error')
  })

  it('returns error for REVERT', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: { result: 'REVERT' } })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('error')
  })

  it('returns error for OUT_OF_TIME', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: { result: 'OUT_OF_TIME' } })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('error')
  })

  it('returns error for BANDWIDTH_ERROR', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: { result: 'BANDWIDTH_ERROR' } })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('error')
  })

  it('returns error for ACCOUNT_FREEZED', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: { result: 'ACCOUNT_FREEZED' } })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('error')
  })

  it('returns error for empty string receipt.result (iOS parity: non-nil optional → failure)', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, receipt: { result: '' } })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('error')
  })

  it('returns error when top-level result is FAILED and receipt is absent (iOS parity)', async () => {
    mocks.queryUrl.mockResolvedValue({ id: hash, blockNumber: 12345, result: 'FAILED' })

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result.status).toBe('error')
  })

  it('returns pending on network error', async () => {
    mocks.queryUrl.mockRejectedValue(new Error('network failure'))

    const result = await getTronTxStatus({ chain: OtherChain.Tron, hash })
    expect(result).toEqual({ status: 'pending' })
  })
})
