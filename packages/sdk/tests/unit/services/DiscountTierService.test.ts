import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CacheService } from '../../../src/services/CacheService'
import { DiscountTierService } from '../../../src/services/DiscountTierService'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'

// Mock the core functions
vi.mock('@core/chain/chains/evm/erc20/getErc20Balance', () => ({
  getErc20Balance: vi.fn(),
}))

vi.mock('@core/chain/chains/evm/erc721/getErc721Balance', () => ({
  getErc721Balance: vi.fn(),
}))

vi.mock('@core/chain/swap/affiliate', () => ({
  getVultDiscountTier: vi.fn(),
}))

vi.mock('@core/chain/coin/knownTokens', () => ({
  vult: {
    id: '0xb788144DF611029C60b859DF47e79B7726C4DEBa',
    chain: 'Ethereum',
    ticker: 'VULT',
    decimals: 18,
  },
}))

import { getErc20Balance } from '@core/chain/chains/evm/erc20/getErc20Balance'
import { getErc721Balance } from '@core/chain/chains/evm/erc721/getErc721Balance'
import { getVultDiscountTier } from '@core/chain/swap/affiliate'

describe('DiscountTierService', () => {
  let service: DiscountTierService
  let cacheService: CacheService
  let storage: MemoryStorage
  const mockEthAddress = '0x1234567890123456789012345678901234567890'

  beforeEach(() => {
    storage = new MemoryStorage()
    cacheService = new CacheService(storage)
    service = new DiscountTierService(cacheService, async () => mockEthAddress)
    vi.clearAllMocks()
  })

  describe('getDiscountTier', () => {
    it('should return null when user has no VULT or Thorguard', async () => {
      vi.mocked(getErc20Balance).mockResolvedValue(0n)
      vi.mocked(getErc721Balance).mockResolvedValue(0n)
      vi.mocked(getVultDiscountTier).mockReturnValue(null)

      const tier = await service.getDiscountTier()

      expect(tier).toBeNull()
      expect(getVultDiscountTier).toHaveBeenCalledWith({
        vultBalance: 0n,
        thorguardNftBalance: 0n,
      })
    })

    it('should return bronze tier for 1500+ VULT', async () => {
      const vultBalance = BigInt(1500) * BigInt(10 ** 18) // 1500 VULT in wei
      vi.mocked(getErc20Balance).mockResolvedValue(vultBalance)
      vi.mocked(getErc721Balance).mockResolvedValue(0n)
      vi.mocked(getVultDiscountTier).mockReturnValue('bronze')

      const tier = await service.getDiscountTier()

      expect(tier).toBe('bronze')
      expect(getVultDiscountTier).toHaveBeenCalledWith({
        vultBalance,
        thorguardNftBalance: 0n,
      })
    })

    it('should return gold tier for 7500+ VULT', async () => {
      const vultBalance = BigInt(7500) * BigInt(10 ** 18)
      vi.mocked(getErc20Balance).mockResolvedValue(vultBalance)
      vi.mocked(getErc721Balance).mockResolvedValue(0n)
      vi.mocked(getVultDiscountTier).mockReturnValue('gold')

      const tier = await service.getDiscountTier()

      expect(tier).toBe('gold')
    })

    it('should return ultimate tier for 1M+ VULT', async () => {
      const vultBalance = BigInt(1_000_000) * BigInt(10 ** 18)
      vi.mocked(getErc20Balance).mockResolvedValue(vultBalance)
      vi.mocked(getErc721Balance).mockResolvedValue(0n)
      vi.mocked(getVultDiscountTier).mockReturnValue('ultimate')

      const tier = await service.getDiscountTier()

      expect(tier).toBe('ultimate')
    })

    it('should upgrade tier when user has Thorguard NFT', async () => {
      const vultBalance = BigInt(1500) * BigInt(10 ** 18) // bronze level VULT
      vi.mocked(getErc20Balance).mockResolvedValue(vultBalance)
      vi.mocked(getErc721Balance).mockResolvedValue(1n) // owns 1 NFT
      vi.mocked(getVultDiscountTier).mockReturnValue('silver') // upgraded from bronze

      const tier = await service.getDiscountTier()

      expect(tier).toBe('silver')
      expect(getVultDiscountTier).toHaveBeenCalledWith({
        vultBalance,
        thorguardNftBalance: 1n,
      })
    })

    it('should cache result and return from cache on subsequent calls', async () => {
      const vultBalance = BigInt(3000) * BigInt(10 ** 18)
      vi.mocked(getErc20Balance).mockResolvedValue(vultBalance)
      vi.mocked(getErc721Balance).mockResolvedValue(0n)
      vi.mocked(getVultDiscountTier).mockReturnValue('silver')

      // First call
      const tier1 = await service.getDiscountTier()
      expect(tier1).toBe('silver')
      expect(getErc20Balance).toHaveBeenCalledTimes(1)
      expect(getErc721Balance).toHaveBeenCalledTimes(1)

      // Second call - should use cache
      const tier2 = await service.getDiscountTier()
      expect(tier2).toBe('silver')
      expect(getErc20Balance).toHaveBeenCalledTimes(1) // Still 1, not 2
      expect(getErc721Balance).toHaveBeenCalledTimes(1)
    })

    it('should handle RPC errors gracefully for VULT balance', async () => {
      vi.mocked(getErc20Balance).mockRejectedValue(new Error('RPC error'))
      vi.mocked(getErc721Balance).mockResolvedValue(0n)
      vi.mocked(getVultDiscountTier).mockReturnValue(null)

      const tier = await service.getDiscountTier()

      expect(tier).toBeNull()
      expect(getVultDiscountTier).toHaveBeenCalledWith({
        vultBalance: 0n, // Falls back to 0
        thorguardNftBalance: 0n,
      })
    })

    it('should handle RPC errors gracefully for Thorguard balance', async () => {
      const vultBalance = BigInt(1500) * BigInt(10 ** 18)
      vi.mocked(getErc20Balance).mockResolvedValue(vultBalance)
      vi.mocked(getErc721Balance).mockRejectedValue(new Error('RPC error'))
      vi.mocked(getVultDiscountTier).mockReturnValue('bronze')

      const tier = await service.getDiscountTier()

      expect(tier).toBe('bronze')
      expect(getVultDiscountTier).toHaveBeenCalledWith({
        vultBalance,
        thorguardNftBalance: 0n, // Falls back to 0
      })
    })

    it('should fetch balances in parallel', async () => {
      const vultBalance = BigInt(3000) * BigInt(10 ** 18)
      let erc20Started = 0
      let erc721Started = 0

      vi.mocked(getErc20Balance).mockImplementation(async () => {
        erc20Started = Date.now()
        await new Promise(resolve => setTimeout(resolve, 50))
        return vultBalance
      })

      vi.mocked(getErc721Balance).mockImplementation(async () => {
        erc721Started = Date.now()
        await new Promise(resolve => setTimeout(resolve, 50))
        return 0n
      })

      vi.mocked(getVultDiscountTier).mockReturnValue('silver')

      await service.getDiscountTier()

      // Both fetches should start within a few ms of each other (parallel)
      expect(Math.abs(erc20Started - erc721Started)).toBeLessThan(20)
    })
  })

  describe('invalidateCache', () => {
    it('should invalidate cache and allow refetch', async () => {
      const vultBalance1 = BigInt(1500) * BigInt(10 ** 18)
      const vultBalance2 = BigInt(7500) * BigInt(10 ** 18)

      vi.mocked(getErc20Balance).mockResolvedValueOnce(vultBalance1).mockResolvedValueOnce(vultBalance2)
      vi.mocked(getErc721Balance).mockResolvedValue(0n)
      vi.mocked(getVultDiscountTier).mockReturnValueOnce('bronze').mockReturnValueOnce('gold')

      // First call
      const tier1 = await service.getDiscountTier()
      expect(tier1).toBe('bronze')
      expect(getErc20Balance).toHaveBeenCalledTimes(1)

      // Invalidate cache
      service.invalidateCache()

      // Second call - should refetch
      const tier2 = await service.getDiscountTier()
      expect(tier2).toBe('gold')
      expect(getErc20Balance).toHaveBeenCalledTimes(2)
    })
  })

  describe('correct addresses', () => {
    it('should use correct VULT token address', async () => {
      vi.mocked(getErc20Balance).mockResolvedValue(0n)
      vi.mocked(getErc721Balance).mockResolvedValue(0n)
      vi.mocked(getVultDiscountTier).mockReturnValue(null)

      await service.getDiscountTier()

      expect(getErc20Balance).toHaveBeenCalledWith({
        chain: 'Ethereum',
        address: '0xb788144DF611029C60b859DF47e79B7726C4DEBa',
        accountAddress: mockEthAddress,
      })
    })

    it('should use correct Thorguard NFT address', async () => {
      vi.mocked(getErc20Balance).mockResolvedValue(0n)
      vi.mocked(getErc721Balance).mockResolvedValue(0n)
      vi.mocked(getVultDiscountTier).mockReturnValue(null)

      await service.getDiscountTier()

      expect(getErc721Balance).toHaveBeenCalledWith({
        chain: 'Ethereum',
        address: '0xa98b29a8f5a247802149c268ecf860b8308b7291',
        accountAddress: mockEthAddress,
      })
    })
  })
})
