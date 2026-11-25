import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getMinimumBalanceForRentExemption = vi.hoisted(() => vi.fn())

vi.mock('./client', () => ({
  getSolanaClient: () => ({ getMinimumBalanceForRentExemption }),
}))

// The cache lives at module scope, so each test loads a fresh copy.
const loadModule = async () => {
  vi.resetModules()
  return import('./tokenAccountRent')
}

const fallbackRent = 2_039_280n

describe('getSolanaTokenAccountRent', () => {
  beforeEach(() => {
    getMinimumBalanceForRentExemption.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the live rent for a 165-byte SPL token account', async () => {
    getMinimumBalanceForRentExemption.mockResolvedValue(1_488_440)
    const { getSolanaTokenAccountRent, splTokenAccountSize } = await loadModule()

    expect(await getSolanaTokenAccountRent()).toBe(1_488_440n)
    expect(splTokenAccountSize).toBe(165)
    expect(getMinimumBalanceForRentExemption).toHaveBeenCalledWith(165)
  })

  it('reuses the live value instead of calling the RPC on every quote', async () => {
    getMinimumBalanceForRentExemption.mockResolvedValue(1_488_440)
    const { getSolanaTokenAccountRent } = await loadModule()

    await Promise.all([getSolanaTokenAccountRent(), getSolanaTokenAccountRent()])
    await getSolanaTokenAccountRent()

    expect(getMinimumBalanceForRentExemption).toHaveBeenCalledTimes(1)
  })

  it('reads the rent again once the cache expires', async () => {
    vi.useFakeTimers()
    getMinimumBalanceForRentExemption.mockResolvedValueOnce(1_488_440).mockResolvedValueOnce(1_300_000)
    const { getSolanaTokenAccountRent, solanaTokenAccountRentCacheTimeMs } = await loadModule()

    expect(await getSolanaTokenAccountRent()).toBe(1_488_440n)
    vi.advanceTimersByTime(solanaTokenAccountRentCacheTimeMs + 1)
    expect(await getSolanaTokenAccountRent()).toBe(1_300_000n)
    expect(getMinimumBalanceForRentExemption).toHaveBeenCalledTimes(2)
  })

  it('falls back to the pre-SIMD-0437 upper bound when the RPC fails', async () => {
    getMinimumBalanceForRentExemption.mockRejectedValue(new Error('503 Service Unavailable'))
    const { getSolanaTokenAccountRent } = await loadModule()

    expect(await getSolanaTokenAccountRent()).toBe(fallbackRent)
  })

  it('does not cache a failed read, so the next call tries the RPC again', async () => {
    getMinimumBalanceForRentExemption.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(1_488_440)
    const { getSolanaTokenAccountRent } = await loadModule()

    expect(await getSolanaTokenAccountRent()).toBe(fallbackRent)
    expect(await getSolanaTokenAccountRent()).toBe(1_488_440n)
    expect(getMinimumBalanceForRentExemption).toHaveBeenCalledTimes(2)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])(
    'falls back when the RPC returns an unusable value (%s)',
    async value => {
      getMinimumBalanceForRentExemption.mockResolvedValue(value)
      const { getSolanaTokenAccountRent } = await loadModule()

      expect(await getSolanaTokenAccountRent()).toBe(fallbackRent)
    }
  )

  it('falls back when the RPC never answers', async () => {
    vi.useFakeTimers()
    getMinimumBalanceForRentExemption.mockReturnValue(new Promise(() => {}))
    const { getSolanaTokenAccountRent } = await loadModule()
    const { solanaRpcTimeoutMs } = await import('./rpcTimeout')

    const rent = getSolanaTokenAccountRent()
    await vi.advanceTimersByTimeAsync(solanaRpcTimeoutMs)

    expect(await rent).toBe(fallbackRent)
  })
})
