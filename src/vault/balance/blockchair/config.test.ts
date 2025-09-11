/**
 * Blockchair Configuration Tests
 */

import { Chain } from '@core/chain/Chain'
import { describe, expect, it } from 'vitest'

import {
  createBlockchairConfig,
  DEFAULT_BLOCKCHAIR_CONFIG,
  getBlockchairChainName,
  getDataSourceForChain,
  isChainSupportedByBlockchair,
  validateBlockchairConfig,
} from './config'

describe('Blockchair Configuration', () => {
  describe('createBlockchairConfig', () => {
    it('should create config with defaults', () => {
      const config = createBlockchairConfig()

      expect(config.enabled).toBe(false)
      expect(config.timeout).toBe(10000)
      expect(config.retries).toBe(3)
      expect(config.fallbackToRpc).toBe(true)
      expect(config.chainOverrides).toEqual({})
    })

    it('should override defaults with provided values', () => {
      const config = createBlockchairConfig({
        enabled: true,
        timeout: 5000,
        apiKey: 'test-key',
      })

      expect(config.enabled).toBe(true)
      expect(config.timeout).toBe(5000)
      expect(config.apiKey).toBe('test-key')
      expect(config.retries).toBe(3) // default preserved
    })
  })

  describe('isChainSupportedByBlockchair', () => {
    it('should return true for supported chains', () => {
      expect(isChainSupportedByBlockchair(Chain.Bitcoin)).toBe(true)
      expect(isChainSupportedByBlockchair(Chain.Ethereum)).toBe(true)
      expect(isChainSupportedByBlockchair(Chain.Solana)).toBe(true)
      expect(isChainSupportedByBlockchair(Chain.Cardano)).toBe(true)
    })

    it('should return false for unsupported chains', () => {
      expect(isChainSupportedByBlockchair(Chain.Cosmos)).toBe(false)
      expect(isChainSupportedByBlockchair(Chain.Terra)).toBe(false)
    })
  })

  describe('getBlockchairChainName', () => {
    it('should return correct Blockchair chain names', () => {
      expect(getBlockchairChainName(Chain.Bitcoin)).toBe('bitcoin')
      expect(getBlockchairChainName(Chain.Ethereum)).toBe('ethereum')
      expect(getBlockchairChainName(Chain.Solana)).toBe('solana')
      expect(getBlockchairChainName(Chain.Cardano)).toBe('cardano')
    })

    it('should return null for unsupported chains', () => {
      expect(getBlockchairChainName(Chain.Cosmos)).toBe(null)
      expect(getBlockchairChainName(Chain.Terra)).toBe(null)
    })
  })

  describe('getDataSourceForChain', () => {
    const baseConfig = createBlockchairConfig({ enabled: true })

    it('should use chain-specific override when provided', () => {
      const config = {
        ...baseConfig,
        chainOverrides: {
          [Chain.Ethereum]: 'rpc' as const,
        },
      }

      expect(getDataSourceForChain(Chain.Ethereum, config)).toBe('rpc')
      expect(getDataSourceForChain(Chain.Bitcoin, config)).toBe('blockchair')
    })

    it('should use Blockchair when enabled and chain is supported', () => {
      expect(getDataSourceForChain(Chain.Ethereum, baseConfig)).toBe(
        'blockchair'
      )
      expect(getDataSourceForChain(Chain.Bitcoin, baseConfig)).toBe(
        'blockchair'
      )
    })

    it('should use RPC when Blockchair is disabled', () => {
      const config = createBlockchairConfig({ enabled: false })
      expect(getDataSourceForChain(Chain.Ethereum, config)).toBe('rpc')
    })

    it('should use RPC for unsupported chains', () => {
      expect(getDataSourceForChain(Chain.Cosmos, baseConfig)).toBe('rpc')
    })
  })

  describe('validateBlockchairConfig', () => {
    it('should return no errors for valid config', () => {
      const config = createBlockchairConfig()
      const errors = validateBlockchairConfig(config)
      expect(errors).toHaveLength(0)
    })

    it('should validate timeout', () => {
      const config = createBlockchairConfig({ timeout: 500 })
      const errors = validateBlockchairConfig(config)
      expect(errors).toContain('Timeout must be at least 1000ms')
    })

    it('should validate retries', () => {
      const config = createBlockchairConfig({ retries: -1 })
      const errors = validateBlockchairConfig(config)
      expect(errors).toContain('Retries must be non-negative')
    })

    it('should validate chain overrides', () => {
      const config = createBlockchairConfig({
        chainOverrides: {
          [Chain.Ethereum]: 'invalid' as any,
        },
      })
      const errors = validateBlockchairConfig(config)
      expect(errors).toContain(
        "Invalid data source 'invalid' for chain Ethereum"
      )
    })
  })

  describe('DEFAULT_BLOCKCHAIR_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_BLOCKCHAIR_CONFIG.enabled).toBe(false)
      expect(DEFAULT_BLOCKCHAIR_CONFIG.timeout).toBe(10000)
      expect(DEFAULT_BLOCKCHAIR_CONFIG.retries).toBe(3)
      expect(DEFAULT_BLOCKCHAIR_CONFIG.fallbackToRpc).toBe(true)
      expect(DEFAULT_BLOCKCHAIR_CONFIG.chainOverrides).toEqual({})
    })
  })
})
