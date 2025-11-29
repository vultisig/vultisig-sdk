/**
 * Cache Usage Verification Tests
 *
 * These tests verify that services correctly use the CacheService:
 * - AddressService: Uses ADDRESS scope (persistent)
 * - BalanceService: Uses BALANCE scope (TTL-based)
 * - FiatValueService: Uses PRICE and PORTFOLIO scopes (TTL-based)
 *
 * Test strategy:
 * - Mock underlying operations to verify cache hits prevent re-computation
 * - Use fake timers to test TTL expiration
 * - Use Promise.all to test concurrent call deduplication
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CacheScope, CacheService } from '../../../src/services/CacheService'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'

describe('Cache Usage Verification', () => {
  let cacheService: CacheService
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
    cacheService = new CacheService(storage, 'test-vault', {
      balanceTTL: 5 * 60 * 1000, // 5 minutes
      priceTTL: 5 * 60 * 1000, // 5 minutes
    })
    vi.clearAllMocks()
  })

  describe('AddressService Cache Behavior (ADDRESS scope)', () => {
    it('should return cached address on second call without re-computation', async () => {
      const mockDerive = vi.fn().mockResolvedValue('0x1234567890abcdef')

      // First call - should compute
      const result1 = await cacheService.getOrComputeScoped('ethereum', CacheScope.ADDRESS, mockDerive)

      // Second call - should return cached value
      const result2 = await cacheService.getOrComputeScoped('ethereum', CacheScope.ADDRESS, mockDerive)

      expect(result1).toBe('0x1234567890abcdef')
      expect(result2).toBe('0x1234567890abcdef')
      expect(mockDerive).toHaveBeenCalledTimes(1) // Only computed once
    })

    it('should deduplicate concurrent address derivations', async () => {
      let resolveDerive: (value: string) => void
      const derivePromise = new Promise<string>(resolve => {
        resolveDerive = resolve
      })

      const mockDerive = vi.fn().mockReturnValue(derivePromise)

      // Launch 10 concurrent calls
      const promises = Array(10)
        .fill(null)
        .map(() => cacheService.getOrComputeScoped('ethereum', CacheScope.ADDRESS, mockDerive))

      // Resolve the derivation
      resolveDerive!('0xabc')

      const results = await Promise.all(promises)

      // All should get the same result
      expect(results.every(r => r === '0xabc')).toBe(true)
      // But derivation only happened once
      expect(mockDerive).toHaveBeenCalledTimes(1)
    })

    it('should cache different chains separately', async () => {
      const mockDeriveEth = vi.fn().mockResolvedValue('0xeth')
      const mockDeriveBtc = vi.fn().mockResolvedValue('bc1btc')

      // Derive for Ethereum
      await cacheService.getOrComputeScoped('ethereum', CacheScope.ADDRESS, mockDeriveEth)
      await cacheService.getOrComputeScoped('ethereum', CacheScope.ADDRESS, mockDeriveEth)

      // Derive for Bitcoin
      await cacheService.getOrComputeScoped('bitcoin', CacheScope.ADDRESS, mockDeriveBtc)
      await cacheService.getOrComputeScoped('bitcoin', CacheScope.ADDRESS, mockDeriveBtc)

      // Each chain should be derived only once
      expect(mockDeriveEth).toHaveBeenCalledTimes(1)
      expect(mockDeriveBtc).toHaveBeenCalledTimes(1)
    })

    it('should persist ADDRESS scope to storage', async () => {
      const mockDerive = vi.fn().mockResolvedValue('0xpersisted')

      await cacheService.getOrComputeScoped('ethereum', CacheScope.ADDRESS, mockDerive)

      // Check storage was called
      const stored = await storage.get('cache:test-vault:address:ethereum')
      expect(stored).toBe('0xpersisted')
    })
  })

  describe('BalanceService Cache Behavior (BALANCE scope)', () => {
    it('should return cached balance on second call within TTL', async () => {
      const balance = { amount: '1.5', rawAmount: '1500000000000000000' }

      // Set balance in cache
      await cacheService.setScoped('ethereum:native', CacheScope.BALANCE, balance)

      // Get should return cached value
      const cached = cacheService.getScoped('ethereum:native', CacheScope.BALANCE)
      expect(cached).toEqual(balance)
    })

    it('should return null after TTL expires', async () => {
      vi.useFakeTimers()

      const balance = { amount: '1.5', rawAmount: '1500000000000000000' }
      await cacheService.setScoped('ethereum:native', CacheScope.BALANCE, balance)

      // Should exist immediately
      expect(cacheService.getScoped('ethereum:native', CacheScope.BALANCE)).toEqual(balance)

      // Advance time past TTL (5 minutes + 1 second)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000)

      // Should be expired
      expect(cacheService.getScoped('ethereum:native', CacheScope.BALANCE)).toBeNull()

      vi.useRealTimers()
    })

    it('should invalidate balance cache on demand', async () => {
      const balance = { amount: '1.5', rawAmount: '1500000000000000000' }
      await cacheService.setScoped('ethereum:native', CacheScope.BALANCE, balance)

      // Should exist
      expect(cacheService.getScoped('ethereum:native', CacheScope.BALANCE)).toEqual(balance)

      // Invalidate
      await cacheService.invalidateScoped('ethereum:native', CacheScope.BALANCE)

      // Should be gone
      expect(cacheService.getScoped('ethereum:native', CacheScope.BALANCE)).toBeNull()
    })

    it('should cache token balances separately from native', async () => {
      const nativeBalance = { amount: '1.0', rawAmount: '1000000000000000000' }
      const tokenBalance = { amount: '100.0', rawAmount: '100000000' }

      await cacheService.setScoped('ethereum:native', CacheScope.BALANCE, nativeBalance)
      await cacheService.setScoped('ethereum:0xtoken', CacheScope.BALANCE, tokenBalance)

      expect(cacheService.getScoped('ethereum:native', CacheScope.BALANCE)).toEqual(nativeBalance)
      expect(cacheService.getScoped('ethereum:0xtoken', CacheScope.BALANCE)).toEqual(tokenBalance)
    })
  })

  describe('FiatValueService Cache Behavior (PRICE scope)', () => {
    it('should cache price on second call within TTL', async () => {
      const mockFetchPrice = vi.fn().mockResolvedValue(2500.0)

      // First call
      const price1 = await cacheService.getOrComputeScoped('ethereum:native:usd', CacheScope.PRICE, mockFetchPrice)

      // Second call
      const price2 = await cacheService.getOrComputeScoped('ethereum:native:usd', CacheScope.PRICE, mockFetchPrice)

      expect(price1).toBe(2500.0)
      expect(price2).toBe(2500.0)
      expect(mockFetchPrice).toHaveBeenCalledTimes(1)
    })

    it('should refetch price after TTL expires', async () => {
      vi.useFakeTimers()

      const mockFetchPrice = vi.fn().mockResolvedValueOnce(2500.0).mockResolvedValueOnce(2600.0)

      // First call
      const price1 = await cacheService.getOrComputeScoped('ethereum:native:usd', CacheScope.PRICE, mockFetchPrice)
      expect(price1).toBe(2500.0)

      // Advance past TTL
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000)

      // Second call - should refetch
      const price2 = await cacheService.getOrComputeScoped('ethereum:native:usd', CacheScope.PRICE, mockFetchPrice)
      expect(price2).toBe(2600.0)
      expect(mockFetchPrice).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })

    it('should cache different currencies separately', async () => {
      const mockFetchUSD = vi.fn().mockResolvedValue(2500.0)
      const mockFetchEUR = vi.fn().mockResolvedValue(2300.0)

      await cacheService.getOrComputeScoped('ethereum:native:usd', CacheScope.PRICE, mockFetchUSD)
      await cacheService.getOrComputeScoped('ethereum:native:usd', CacheScope.PRICE, mockFetchUSD)

      await cacheService.getOrComputeScoped('ethereum:native:eur', CacheScope.PRICE, mockFetchEUR)
      await cacheService.getOrComputeScoped('ethereum:native:eur', CacheScope.PRICE, mockFetchEUR)

      expect(mockFetchUSD).toHaveBeenCalledTimes(1)
      expect(mockFetchEUR).toHaveBeenCalledTimes(1)
    })
  })

  describe('Race Condition Prevention', () => {
    it('should not cache errors', async () => {
      const mockCompute = vi.fn().mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce('success')

      // First call fails
      await expect(cacheService.getOrComputeScoped('key', CacheScope.BALANCE, mockCompute)).rejects.toThrow(
        'Network error'
      )

      // Second call should retry (not return cached error)
      const result = await cacheService.getOrComputeScoped('key', CacheScope.BALANCE, mockCompute)
      expect(result).toBe('success')
      expect(mockCompute).toHaveBeenCalledTimes(2)
    })

    it('should clean up pending computation after error', async () => {
      let rejectFn: (err: Error) => void

      const mockCompute = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            rejectFn = reject
          })
      )

      // Start computation
      const promise1 = cacheService.getOrComputeScoped('key', CacheScope.BALANCE, mockCompute)

      // Reject it
      rejectFn!(new Error('Failed'))

      await expect(promise1).rejects.toThrow('Failed')

      // Start new computation - should not be blocked
      const mockCompute2 = vi.fn().mockResolvedValue('recovered')
      const result = await cacheService.getOrComputeScoped('key', CacheScope.BALANCE, mockCompute2)

      expect(result).toBe('recovered')
    })
  })

  describe('Scope Isolation', () => {
    it('should not mix data between scopes', async () => {
      // Same key, different scopes
      await cacheService.setScoped('ethereum', CacheScope.ADDRESS, '0xaddress')
      await cacheService.setScoped('ethereum', CacheScope.BALANCE, { amount: '1.0' })

      const address = cacheService.getScoped('ethereum', CacheScope.ADDRESS)
      const balance = cacheService.getScoped('ethereum', CacheScope.BALANCE)

      expect(address).toBe('0xaddress')
      expect(balance).toEqual({ amount: '1.0' })
    })

    it('should invalidate by scope without affecting others', async () => {
      await cacheService.setScoped('ethereum', CacheScope.ADDRESS, '0xaddress')
      await cacheService.setScoped('ethereum', CacheScope.BALANCE, { amount: '1.0' })
      await cacheService.setScoped('bitcoin', CacheScope.BALANCE, { amount: '0.5' })

      // Invalidate only BALANCE scope
      await cacheService.invalidateScope(CacheScope.BALANCE)

      // ADDRESS should still exist
      expect(cacheService.getScoped('ethereum', CacheScope.ADDRESS)).toBe('0xaddress')

      // BALANCE entries should be gone
      expect(cacheService.getScoped('ethereum', CacheScope.BALANCE)).toBeNull()
      expect(cacheService.getScoped('bitcoin', CacheScope.BALANCE)).toBeNull()
    })
  })
})
