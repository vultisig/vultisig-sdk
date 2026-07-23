import { sleep } from '@vultisig/lib-utils/sleep'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Chain } from '../../Chain'
import { getTxHash } from '../hash'
import { getTxStatus } from '../status'
import {
  broadcastVerificationBaseDelayMs,
  broadcastVerificationMaxAttempts,
  verifyBroadcastByHash,
} from './verifyBroadcastByHash'

vi.mock('../hash', () => ({
  getTxHash: vi.fn(),
}))
vi.mock('../status', () => ({
  getTxStatus: vi.fn(),
}))
vi.mock('@vultisig/lib-utils/sleep', () => ({
  sleep: vi.fn(),
}))

const getTxHashMock = vi.mocked(getTxHash)
const getTxStatusMock = vi.mocked(getTxStatus)
const sleepMock = vi.mocked(sleep)

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

    await expect(verifyBroadcastByHash({ chain, tx, error: originalError })).resolves.toBeUndefined()

    expect(getTxHashMock).toHaveBeenCalledTimes(1)
    expect(getTxHashMock).toHaveBeenCalledWith({ chain, tx })
    expect(getTxStatusMock).toHaveBeenCalledTimes(1)
    expect(getTxStatusMock).toHaveBeenCalledWith({
      chain,
      hash: '0xdeadbeef',
    })
  })

  it("rethrows original error when status is 'pending' but tx is unknown", async () => {
    const originalError = new Error('broadcast boom')
    getTxHashMock.mockResolvedValue('0xdeadbeef')
    getTxStatusMock.mockResolvedValue({ status: 'pending', isKnown: false })

    await expect(verifyBroadcastByHash({ chain, tx, error: originalError })).rejects.toBe(originalError)

    expect(getTxStatusMock).toHaveBeenCalledTimes(broadcastVerificationMaxAttempts)
    expect(sleepMock).toHaveBeenCalledTimes(broadcastVerificationMaxAttempts - 1)
  })

  it("retries a transient 'not_found' status before accepting success", async () => {
    const originalError = new Error('Unexpected error (code=10055)')
    getTxHashMock.mockResolvedValue('0xeb475a')
    getTxStatusMock.mockResolvedValueOnce({ status: 'not_found', isKnown: false }).mockResolvedValueOnce({
      status: 'success',
    })

    await expect(verifyBroadcastByHash({ chain, tx, error: originalError })).resolves.toBeUndefined()

    expect(getTxHashMock).toHaveBeenCalledTimes(1)
    expect(getTxStatusMock).toHaveBeenCalledTimes(2)
    expect(sleepMock).toHaveBeenCalledOnce()
    expect(sleepMock).toHaveBeenCalledWith(broadcastVerificationBaseDelayMs)
  })

  it("rethrows the original error after repeated 'not_found' statuses", async () => {
    const originalError = new Error('broadcast failed')
    getTxHashMock.mockResolvedValue('0xmissing')
    getTxStatusMock.mockResolvedValue({ status: 'not_found', isKnown: false })

    await expect(verifyBroadcastByHash({ chain, tx, error: originalError })).rejects.toBe(originalError)

    expect(getTxStatusMock).toHaveBeenCalledTimes(broadcastVerificationMaxAttempts)
    expect(sleepMock).toHaveBeenCalledTimes(broadcastVerificationMaxAttempts - 1)
  })

  it('recovers when a status lookup fails before a known pending result', async () => {
    const originalError = new Error('broadcast failed')
    getTxHashMock.mockResolvedValue('0xpending')
    getTxStatusMock.mockRejectedValueOnce(new Error('rpc down')).mockResolvedValueOnce({
      status: 'pending',
      isKnown: true,
    })

    await expect(verifyBroadcastByHash({ chain, tx, error: originalError })).resolves.toBeUndefined()

    expect(getTxStatusMock).toHaveBeenCalledTimes(2)
    expect(sleepMock).toHaveBeenCalledOnce()
  })

  it("swallows error when status is 'success'", async () => {
    const originalError = new Error('duplicate tx')
    getTxHashMock.mockResolvedValue('0xabc')
    getTxStatusMock.mockResolvedValue({ status: 'success' })

    await expect(verifyBroadcastByHash({ chain, tx, error: originalError })).resolves.toBeUndefined()
  })

  it("rethrows original error when status is 'error'", async () => {
    const originalError = new Error('broadcast boom')
    getTxHashMock.mockResolvedValue('0xabc')
    getTxStatusMock.mockResolvedValue({ status: 'error' })

    await expect(verifyBroadcastByHash({ chain, tx, error: originalError })).rejects.toBe(originalError)

    expect(getTxStatusMock).toHaveBeenCalledTimes(1)
    expect(sleepMock).not.toHaveBeenCalled()
  })

  it('retries getTxStatus failures before rethrowing the original error', async () => {
    const originalError = new Error('broadcast failed')
    getTxHashMock.mockResolvedValue('0xabc')
    getTxStatusMock.mockRejectedValue(new Error('rpc down'))

    await expect(verifyBroadcastByHash({ chain, tx, error: originalError })).rejects.toBe(originalError)

    expect(getTxStatusMock).toHaveBeenCalledTimes(broadcastVerificationMaxAttempts)
    expect(sleepMock).toHaveBeenCalledTimes(broadcastVerificationMaxAttempts - 1)
  })

  it('rethrows original error when getTxHash throws', async () => {
    const originalError = new Error('original')
    getTxHashMock.mockRejectedValue(new Error('hash boom'))

    await expect(verifyBroadcastByHash({ chain, tx, error: originalError })).rejects.toBe(originalError)

    expect(getTxStatusMock).not.toHaveBeenCalled()
    expect(sleepMock).not.toHaveBeenCalled()
  })

  it('supports non-Error error values', async () => {
    getTxHashMock.mockResolvedValue('0xabc')
    getTxStatusMock.mockResolvedValue({ status: 'error' })

    await expect(verifyBroadcastByHash({ chain, tx, error: 'string-error' })).rejects.toBe('string-error')
  })
})
