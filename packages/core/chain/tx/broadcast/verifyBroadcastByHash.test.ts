import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../hash', () => ({
  getTxHash: vi.fn(),
}))
vi.mock('../status', () => ({
  getTxStatus: vi.fn(),
}))

import { Chain } from '../../Chain'
import { getTxHash } from '../hash'
import { getTxStatus } from '../status'

import { verifyBroadcastByHash } from './verifyBroadcastByHash'

const getTxHashMock = vi.mocked(getTxHash)
const getTxStatusMock = vi.mocked(getTxStatus)

describe('verifyBroadcastByHash', () => {
  const chain = Chain.Ethereum
  const tx = {} as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("swallows error when status is 'pending'", async () => {
    const originalError = new Error('duplicate tx')
    getTxHashMock.mockResolvedValue('0xdeadbeef')
    getTxStatusMock.mockResolvedValue({ status: 'pending' })

    await expect(
      verifyBroadcastByHash({ chain, tx, error: originalError }),
    ).resolves.toBeUndefined()

    expect(getTxHashMock).toHaveBeenCalledTimes(1)
    expect(getTxHashMock).toHaveBeenCalledWith({ chain, tx })
    expect(getTxStatusMock).toHaveBeenCalledTimes(1)
    expect(getTxStatusMock).toHaveBeenCalledWith({
      chain,
      hash: '0xdeadbeef',
    })
  })

  it("swallows error when status is 'success'", async () => {
    const originalError = new Error('duplicate tx')
    getTxHashMock.mockResolvedValue('0xabc')
    getTxStatusMock.mockResolvedValue({ status: 'success' })

    await expect(
      verifyBroadcastByHash({ chain, tx, error: originalError }),
    ).resolves.toBeUndefined()
  })

  it("rethrows original error when status is 'error'", async () => {
    const originalError = new Error('broadcast boom')
    getTxHashMock.mockResolvedValue('0xabc')
    getTxStatusMock.mockResolvedValue({ status: 'error' })

    await expect(
      verifyBroadcastByHash({ chain, tx, error: originalError }),
    ).rejects.toBe(originalError)
  })

  it('rethrows original error when getTxStatus throws', async () => {
    const originalError = new Error('broadcast failed')
    getTxHashMock.mockResolvedValue('0xabc')
    getTxStatusMock.mockRejectedValue(new Error('rpc down'))

    await expect(
      verifyBroadcastByHash({ chain, tx, error: originalError }),
    ).rejects.toBe(originalError)
  })

  it('rethrows original error when getTxHash throws', async () => {
    const originalError = new Error('original')
    getTxHashMock.mockRejectedValue(new Error('hash boom'))

    await expect(
      verifyBroadcastByHash({ chain, tx, error: originalError }),
    ).rejects.toBe(originalError)

    expect(getTxStatusMock).not.toHaveBeenCalled()
  })

  it('supports non-Error error values', async () => {
    getTxHashMock.mockResolvedValue('0xabc')
    getTxStatusMock.mockResolvedValue({ status: 'error' })

    await expect(
      verifyBroadcastByHash({ chain, tx, error: 'string-error' }),
    ).rejects.toBe('string-error')
  })
})
