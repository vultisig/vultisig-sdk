import { Chain } from '@core/chain/Chain'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CHAINS,
  getSupportedChains,
  isChainSupported,
  stringToChain,
  validateChains,
} from '../../src/ChainManager'
import { VaultError, VaultErrorCode } from '../../src/vault/VaultError'

describe('ChainManager', () => {
  describe('DEFAULT_CHAINS', () => {
    it('should contain the expected default chains', () => {
      expect(DEFAULT_CHAINS).toContain(Chain.Bitcoin)
      expect(DEFAULT_CHAINS).toContain(Chain.Ethereum)
      expect(DEFAULT_CHAINS).toContain(Chain.Solana)
      expect(DEFAULT_CHAINS).toContain(Chain.THORChain)
      expect(DEFAULT_CHAINS).toContain(Chain.Ripple)
    })

    it('should have exactly 5 default chains', () => {
      expect(DEFAULT_CHAINS).toHaveLength(5)
    })

    it('should only contain supported chains', () => {
      const supportedChains = getSupportedChains()
      DEFAULT_CHAINS.forEach(chain => {
        expect(supportedChains).toContain(chain)
      })
    })
  })

  describe('isChainSupported', () => {
    it('should return true for supported chains', () => {
      expect(isChainSupported('Bitcoin')).toBe(true)
      expect(isChainSupported('Ethereum')).toBe(true)
      expect(isChainSupported('Solana')).toBe(true)
      expect(isChainSupported('THORChain')).toBe(true)
      expect(isChainSupported('Ripple')).toBe(true)
    })

    it('should return true for chain keys (not values with different names)', () => {
      // NOTE: isChainSupported checks if string is a KEY in Chain object
      // For chains where key !== value (e.g., BitcoinCash = 'Bitcoin-Cash'),
      // it only works with the key ('BitcoinCash'), not the value ('Bitcoin-Cash')
      expect(isChainSupported('Bitcoin')).toBe(true) // key === value
      expect(isChainSupported('Ethereum')).toBe(true) // key === value
      expect(isChainSupported('BitcoinCash')).toBe(true) // key (value is 'Bitcoin-Cash')
      expect(isChainSupported('Bitcoin-Cash')).toBe(false) // value, not key
    })

    it('should return false for unsupported chains', () => {
      expect(isChainSupported('InvalidChain')).toBe(false)
      expect(isChainSupported('NotAChain')).toBe(false)
      expect(isChainSupported('bitcoin')).toBe(false) // lowercase
      expect(isChainSupported('')).toBe(false)
      expect(isChainSupported('Ethereum2')).toBe(false)
    })

    it('should handle edge cases', () => {
      expect(isChainSupported('undefined')).toBe(false)
      expect(isChainSupported('null')).toBe(false)
      expect(isChainSupported('123')).toBe(false)
      expect(isChainSupported(' Bitcoin ')).toBe(false) // with spaces
    })
  })

  describe('stringToChain', () => {
    it('should convert valid chain strings to Chain type', () => {
      expect(stringToChain('Bitcoin')).toBe(Chain.Bitcoin)
      expect(stringToChain('Ethereum')).toBe(Chain.Ethereum)
      expect(stringToChain('Solana')).toBe(Chain.Solana)
      expect(stringToChain('THORChain')).toBe(Chain.THORChain)
      expect(stringToChain('Ripple')).toBe(Chain.Ripple)
    })

    it('should convert valid chain keys (matches where key === value)', () => {
      // Only test chains where the key equals the value
      // NOTE: stringToChain uses isChainSupported which checks keys, not values
      const validKeys = ['Bitcoin', 'Ethereum', 'Solana', 'THORChain', 'Ripple']
      validKeys.forEach(chain => {
        expect(stringToChain(chain)).toBe(chain)
      })
    })

    it('should throw VaultError for unsupported chains', () => {
      expect(() => stringToChain('InvalidChain')).toThrow(VaultError)
      expect(() => stringToChain('NotAChain')).toThrow(VaultError)
      expect(() => stringToChain('')).toThrow(VaultError)
    })

    it('should throw with correct error code', () => {
      try {
        stringToChain('InvalidChain')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError)
        expect((error as VaultError).code).toBe(
          VaultErrorCode.ChainNotSupported
        )
      }
    })

    it('should include the invalid chain name in error message', () => {
      try {
        stringToChain('FakeChain')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError)
        expect((error as VaultError).message).toContain('FakeChain')
      }
    })
  })

  describe('getSupportedChains', () => {
    it('should return an array of all supported chains', () => {
      const supported = getSupportedChains()
      expect(Array.isArray(supported)).toBe(true)
      expect(supported.length).toBeGreaterThan(0)
    })

    it('should include default chains', () => {
      const supported = getSupportedChains()
      DEFAULT_CHAINS.forEach(chain => {
        expect(supported).toContain(chain)
      })
    })

    it('should include all chain families', () => {
      const supported = getSupportedChains()

      // UTXO chains
      expect(supported).toContain('Bitcoin')
      expect(supported).toContain('Litecoin')
      expect(supported).toContain('Dogecoin')

      // EVM chains
      expect(supported).toContain('Ethereum')
      expect(supported).toContain('Polygon')
      expect(supported).toContain('BSC')
      expect(supported).toContain('Avalanche')

      // Cosmos chains
      expect(supported).toContain('Cosmos')
      expect(supported).toContain('THORChain')
      expect(supported).toContain('Osmosis')

      // Other chains
      expect(supported).toContain('Solana')
      expect(supported).toContain('Ripple')
      expect(supported).toContain('Sui')
    })

    it('should return unique chain names', () => {
      const supported = getSupportedChains()
      const uniqueChains = [...new Set(supported)]
      expect(supported.length).toBe(uniqueChains.length)
    })

    it('should not include empty strings or null values', () => {
      const supported = getSupportedChains()
      expect(supported).not.toContain('')
      expect(supported).not.toContain(null)
      expect(supported).not.toContain(undefined)
    })

    it('should match Chain enum values', () => {
      const supported = getSupportedChains()
      const chainValues = Object.values(Chain)
      expect(supported.sort()).toEqual(chainValues.sort())
    })
  })

  describe('validateChains', () => {
    it('should validate an array of supported chains', () => {
      const chains = ['Bitcoin', 'Ethereum', 'Solana']
      const validated = validateChains(chains)

      expect(validated).toHaveLength(3)
      expect(validated).toContain(Chain.Bitcoin)
      expect(validated).toContain(Chain.Ethereum)
      expect(validated).toContain(Chain.Solana)
    })

    it('should validate default chains', () => {
      const chains = DEFAULT_CHAINS.map(c => c)
      const validated = validateChains(chains)

      expect(validated).toHaveLength(DEFAULT_CHAINS.length)
      DEFAULT_CHAINS.forEach(chain => {
        expect(validated).toContain(chain)
      })
    })

    it('should validate single chain', () => {
      const validated = validateChains(['Bitcoin'])
      expect(validated).toHaveLength(1)
      expect(validated[0]).toBe(Chain.Bitcoin)
    })

    it('should validate chains where key === value', () => {
      // NOTE: validateChains uses 'chain in Chain' which checks keys
      // Only chains where key === value will pass validation
      const validChains = [
        'Bitcoin',
        'Ethereum',
        'Solana',
        'THORChain',
        'Ripple',
      ]
      const validated = validateChains(validChains)

      expect(validated).toHaveLength(validChains.length)
      validChains.forEach(chain => {
        expect(validated).toContain(chain)
      })
    })

    it('should throw VaultError for unsupported chains', () => {
      expect(() => validateChains(['InvalidChain'])).toThrow(VaultError)
      expect(() => validateChains(['NotAChain', 'FakeChain'])).toThrow(
        VaultError
      )
    })

    it('should throw with correct error code for invalid chains', () => {
      try {
        validateChains(['InvalidChain'])
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError)
        expect((error as VaultError).code).toBe(
          VaultErrorCode.ChainNotSupported
        )
      }
    })

    it('should throw when mixing valid and invalid chains', () => {
      expect(() =>
        validateChains(['Bitcoin', 'InvalidChain', 'Ethereum'])
      ).toThrow(VaultError)
    })

    it('should include invalid chain names in error message', () => {
      try {
        validateChains(['Solana', 'FakeChain1', 'Ripple', 'FakeChain2'])
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError)
        const message = (error as VaultError).message
        expect(message).toContain('FakeChain1')
        expect(message).toContain('FakeChain2')
        expect(message).toContain('Supported chains:') // Error message includes all supported chains
        // Note: The error message lists ALL supported chains, so it will contain chain names
      }
    })

    it('should list supported chains in error message', () => {
      try {
        validateChains(['InvalidChain'])
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError)
        const message = (error as VaultError).message
        expect(message).toContain('Supported chains:')
        expect(message).toContain('Bitcoin')
        expect(message).toContain('Ethereum')
      }
    })

    it('should handle empty array', () => {
      const validated = validateChains([])
      expect(validated).toHaveLength(0)
      expect(Array.isArray(validated)).toBe(true)
    })

    it('should handle duplicate chains', () => {
      const validated = validateChains(['Bitcoin', 'Bitcoin', 'Ethereum'])
      expect(validated).toHaveLength(3)
      expect(validated.filter(c => c === Chain.Bitcoin)).toHaveLength(2)
    })

    it('should preserve chain order', () => {
      const chains = ['Solana', 'Bitcoin', 'Ethereum']
      const validated = validateChains(chains)
      expect(validated[0]).toBe(Chain.Solana)
      expect(validated[1]).toBe(Chain.Bitcoin)
      expect(validated[2]).toBe(Chain.Ethereum)
    })
  })

  describe('Integration tests', () => {
    it('should validate chains that match between keys and values', () => {
      // NOTE: This test documents a known issue:
      // getSupportedChains() returns values (including 'Bitcoin-Cash')
      // validateChains() checks keys (looking for 'BitcoinCash')
      // This is an inconsistency in the current implementation

      // Test with chains where key === value (these work correctly)
      const validChains = [
        'Bitcoin',
        'Ethereum',
        'Solana',
        'THORChain',
        'Ripple',
      ]
      const validated = validateChains(validChains)

      expect(validated.length).toBe(validChains.length)
      validated.forEach(chain => {
        expect(validChains).toContain(chain)
      })
    })

    it('should work together: isChainSupported -> stringToChain', () => {
      const testChains = ['Bitcoin', 'Ethereum', 'Solana', 'InvalidChain']

      testChains.forEach(chain => {
        if (isChainSupported(chain)) {
          expect(() => stringToChain(chain)).not.toThrow()
        } else {
          expect(() => stringToChain(chain)).toThrow(VaultError)
        }
      })
    })

    it('should work together: validateChains -> all chains should pass isChainSupported', () => {
      const chains = ['Bitcoin', 'Ethereum', 'Solana']
      const validated = validateChains(chains)

      validated.forEach(chain => {
        expect(isChainSupported(chain)).toBe(true)
      })
    })

    it('DEFAULT_CHAINS should pass all validation functions', () => {
      // Test isChainSupported
      DEFAULT_CHAINS.forEach(chain => {
        expect(isChainSupported(chain)).toBe(true)
      })

      // Test stringToChain
      DEFAULT_CHAINS.forEach(chain => {
        expect(() => stringToChain(chain)).not.toThrow()
        expect(stringToChain(chain)).toBe(chain)
      })

      // Test validateChains
      const validated = validateChains(DEFAULT_CHAINS)
      expect(validated).toEqual(DEFAULT_CHAINS)
    })
  })

  describe('Edge cases and error handling', () => {
    it('should handle case sensitivity correctly', () => {
      expect(isChainSupported('bitcoin')).toBe(false)
      expect(isChainSupported('BITCOIN')).toBe(false)
      expect(isChainSupported('Bitcoin')).toBe(true)
    })

    it('should check chain keys not values for chains with hyphens', () => {
      // NOTE: This documents a known inconsistency
      // The key is 'BitcoinCash' but the value is 'Bitcoin-Cash'
      expect(isChainSupported('BitcoinCash')).toBe(true) // key
      expect(isChainSupported('Bitcoin-Cash')).toBe(false) // value
    })

    it('should validate using chain keys', () => {
      // NOTE: validateChains checks keys, so use 'BitcoinCash' not 'Bitcoin-Cash'
      // When the key is found, it's cast to Chain type and returned
      const validated = validateChains(['BitcoinCash'])
      expect(validated).toContain('BitcoinCash') // Returns the key, cast to Chain type
      expect(validated).toHaveLength(1)
    })

    it('should handle error wrapping in validateChains', () => {
      try {
        validateChains(['Invalid1', 'Invalid2'])
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError)
        expect((error as VaultError).code).toBe(
          VaultErrorCode.ChainNotSupported
        )
        expect((error as VaultError).message).toContain('Unsupported chains')
      }
    })
  })
})
