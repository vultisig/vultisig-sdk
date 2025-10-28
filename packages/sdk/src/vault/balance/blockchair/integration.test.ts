/**
 * Blockchair Integration Tests
 */

import { Chain } from '@core/chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  blockchairFirstResolver,
  createSmartBalanceResolver,
  createSmartTransactionResolver,
  getBalanceWithBlockchair,
  getTransactionWithBlockchair,
  rpcOnlyResolver,
  selectiveBlockchairResolver,
  SmartBalanceResolver,
} from './integration'

// Mock the balance resolvers
vi.mock('./resolvers/evm', () => ({
  getBlockchairEvmCoinBalance: vi.fn(),
}))

vi.mock('./resolvers/solana', () => ({
  getBlockchairSolanaCoinBalance: vi.fn(),
}))

vi.mock('./resolvers/cardano', () => ({
  getBlockchairCardanoCoinBalance: vi.fn(),
}))

vi.mock('@core/chain/coin/balance', () => ({
  getCoinBalance: vi.fn(),
}))

vi.mock('./resolvers/transaction', () => ({
  getBlockchairTransaction: vi.fn(),
}))

import { getCoinBalance } from '@core/chain/coin/balance'

import { getBlockchairCardanoCoinBalance } from './resolvers/cardano'
import { getBlockchairEvmCoinBalance } from './resolvers/evm'
import { getBlockchairSolanaCoinBalance } from './resolvers/solana'
import { getBlockchairTransaction } from './resolvers/transaction'

describe('SmartBalanceResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getBalance', () => {
    const mockAccount = {
      chain: Chain.Ethereum,
      address: '0x1234567890123456789012345678901234567890',
      id: 'ETH',
    }

    it('should use Blockchair for supported chains when enabled', async () => {
      const balanceResolver = createSmartBalanceResolver({ enabled: true })
      ;(getBlockchairEvmCoinBalance as any).mockResolvedValue(
        1000000000000000000n
      )

      const result = await balanceResolver.getBalance(mockAccount)

      expect(getBlockchairEvmCoinBalance).toHaveBeenCalledWith(mockAccount)
      expect(result).toBe(1000000000000000000n)
    })

    it('should fallback to RPC when Blockchair fails', async () => {
      const balanceResolver = createSmartBalanceResolver({
        enabled: true,
        fallbackToRpc: true,
      })
      ;(getBlockchairEvmCoinBalance as any).mockRejectedValue(
        new Error('Blockchair error')
      )
      ;(getCoinBalance as any).mockResolvedValue(500000000000000000n)

      const result = await balanceResolver.getBalance(mockAccount)

      expect(getBlockchairEvmCoinBalance).toHaveBeenCalled()
      expect(getCoinBalance).toHaveBeenCalledWith(mockAccount)
      expect(result).toBe(500000000000000000n)
    })

    it('should use RPC directly when Blockchair is disabled', async () => {
      const resolver = createSmartBalanceResolver({ enabled: false })
      ;(getCoinBalance as any).mockResolvedValue(2000000000000000000n)

      const result = await resolver.getBalance(mockAccount)

      expect(getCoinBalance).toHaveBeenCalledWith(mockAccount)
      expect(getBlockchairEvmCoinBalance).not.toHaveBeenCalled()
      expect(result).toBe(2000000000000000000n)
    })

    it('should use RPC for unsupported chains', async () => {
      const resolver = createSmartBalanceResolver({ enabled: true })
      const cosmosAccount = { ...mockAccount, chain: Chain.Cosmos }
      ;(getCoinBalance as any).mockResolvedValue(3000000000000000000n)

      const result = await resolver.getBalance(cosmosAccount)

      expect(getCoinBalance).toHaveBeenCalledWith(cosmosAccount)
      expect(result).toBe(3000000000000000000n)
    })
  })

  describe('chain-specific resolvers', () => {
    it('should use EVM resolver for Ethereum', async () => {
      const resolver = createSmartBalanceResolver({ enabled: true })
      const account = {
        chain: Chain.Ethereum,
        address: '0x1234',
        id: 'ETH',
      }
      ;(getBlockchairEvmCoinBalance as any).mockResolvedValue(1000n)

      await resolver.getBalance(account)

      expect(getBlockchairEvmCoinBalance).toHaveBeenCalledWith(account)
    })

    it('should use Solana resolver for Solana', async () => {
      const resolver = createSmartBalanceResolver({ enabled: true })
      const account = {
        chain: Chain.Solana,
        address: 'solana-address',
        id: 'SOL',
      }
      ;(getBlockchairSolanaCoinBalance as any).mockResolvedValue(2000n)

      await resolver.getBalance(account)

      expect(getBlockchairSolanaCoinBalance).toHaveBeenCalledWith(account)
    })

    it('should use Cardano resolver for Cardano', async () => {
      const resolver = createSmartBalanceResolver({ enabled: true })
      const account = {
        chain: Chain.Cardano,
        address: 'cardano-address',
        id: 'ADA',
      }
      ;(getBlockchairCardanoCoinBalance as any).mockResolvedValue(3000n)

      await resolver.getBalance(account)

      expect(getBlockchairCardanoCoinBalance).toHaveBeenCalledWith(account)
    })
  })

  describe('configuration management', () => {
    it('should allow updating configuration', () => {
      const resolver = new SmartBalanceResolver()
      const newConfig = { enabled: true, timeout: 5000 }

      resolver.updateConfig(newConfig)

      const config = resolver.getConfig()
      expect(config.enabled).toBe(true)
      expect(config.timeout).toBe(5000)
    })
  })
})

describe('SmartTransactionResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getTransaction', () => {
    it('should use Blockchair for supported chains when enabled', async () => {
      const txResolver = createSmartTransactionResolver({ enabled: true })
      const mockResult = { hash: '0x123', success: true }
      ;(getBlockchairTransaction as any).mockResolvedValue(mockResult)

      const result = await txResolver.getTransaction('ethereum', '0x123')

      expect(getBlockchairTransaction).toHaveBeenCalledWith('ethereum', '0x123')
      expect(result).toEqual(mockResult)
    })

    it('should throw error for unsupported chains', async () => {
      const txResolver = createSmartTransactionResolver({ enabled: true })

      await expect(
        txResolver.getTransaction('cosmos', 'tx123')
      ).rejects.toThrow('Transaction lookup not available for chain: cosmos')
    })
  })
})

describe('Pre-configured resolvers', () => {
  describe('blockchairFirstResolver', () => {
    it('should be configured to use Blockchair first', () => {
      const config = blockchairFirstResolver.getConfig()
      expect(config.enabled).toBe(true)
      expect(config.fallbackToRpc).toBe(true)
    })
  })

  describe('rpcOnlyResolver', () => {
    it('should be configured to use RPC only', () => {
      const config = rpcOnlyResolver.getConfig()
      expect(config.enabled).toBe(false)
    })
  })

  describe('selectiveBlockchairResolver', () => {
    it('should be configured with selective chain overrides', () => {
      const config = selectiveBlockchairResolver.getConfig()
      expect(config.enabled).toBe(true)
      expect(config.chainOverrides?.[Chain.Ethereum]).toBe('blockchair')
      expect(config.chainOverrides?.[Chain.Bitcoin]).toBe('blockchair')
      expect(config.chainOverrides?.[Chain.Solana]).toBe('blockchair')
    })
  })
})

describe('Convenience functions', () => {
  describe('getBalanceWithBlockchair', () => {
    it('should create resolver and get balance', async () => {
      const mockAccount = {
        chain: Chain.Ethereum,
        address: '0x1234',
        id: 'ETH',
      }
      ;(getBlockchairEvmCoinBalance as any).mockResolvedValue(1000n)

      const result = await getBalanceWithBlockchair(mockAccount, {
        enabled: true,
      })

      expect(result).toBe(1000n)
    })
  })

  describe('getTransactionWithBlockchair', () => {
    it('should create resolver and get transaction', async () => {
      const mockResult = { hash: '0x123', success: true }
      ;(getBlockchairTransaction as any).mockResolvedValue(mockResult)

      const result = await getTransactionWithBlockchair('ethereum', '0x123', {
        enabled: true,
      })

      expect(result).toEqual(mockResult)
    })
  })
})
