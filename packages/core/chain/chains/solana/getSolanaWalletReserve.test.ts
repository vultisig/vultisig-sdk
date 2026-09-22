import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getMinimumBalanceForRentExemption } = vi.hoisted(() => ({
  getMinimumBalanceForRentExemption: vi.fn(),
}))
vi.mock('./client', () => ({ getSolanaClient: () => ({ getMinimumBalanceForRentExemption }) }))

import { getSolanaWalletReserve } from './getSolanaWalletReserve'

describe('getSolanaWalletReserve', () => {
  beforeEach(() => vi.resetAllMocks())

  it('reads the current zero-data wallet reserve on each call', async () => {
    getMinimumBalanceForRentExemption.mockResolvedValueOnce(650240).mockResolvedValueOnce(890880)
    await expect(getSolanaWalletReserve()).resolves.toBe(650240n)
    await expect(getSolanaWalletReserve()).resolves.toBe(890880n)
    expect(getMinimumBalanceForRentExemption.mock.calls).toEqual([[0], [0]])
  })

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined, null, '650240'])(
    'rejects an unavailable or invalid reserve: %s',
    async reserve => {
      getMinimumBalanceForRentExemption.mockResolvedValue(reserve)
      await expect(getSolanaWalletReserve()).rejects.toThrow('Invalid Solana wallet rent-exempt reserve')
    }
  )

  it('propagates RPC failure', async () => {
    getMinimumBalanceForRentExemption.mockRejectedValue(new Error('RPC unavailable'))
    await expect(getSolanaWalletReserve()).rejects.toThrow('RPC unavailable')
  })
})
