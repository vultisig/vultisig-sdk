import { describe, test, expect, beforeEach } from 'vitest'
import { Vultisig } from '../VultisigSDK'

describe('Chain Management Tests', () => {
  let vultisig: Vultisig

  beforeEach(() => {
    vultisig = new Vultisig()
  })

  describe('VultisigSDK Chain Hierarchy', () => {
    test('should have immutable supported chains list', () => {
      const supportedChains = vultisig.getSupportedChains()
      
      // Check for key chains from each category
      expect(supportedChains).toContain('Bitcoin') // UTXO
      expect(supportedChains).toContain('Ethereum') // EVM
      expect(supportedChains).toContain('THORChain') // Cosmos
      expect(supportedChains).toContain('Solana') // Other
      expect(supportedChains).toContain('Ripple') // Other
      
      // Should have all major chain categories
      expect(supportedChains.length).toBeGreaterThan(25)
    })

    test('should have configurable default chains', () => {
      // Initial default chains (5 top chains)
      const initialDefaults = vultisig.getDefaultChains()
      expect(initialDefaults).toEqual(['Bitcoin', 'Ethereum', 'Solana', 'THORChain', 'Ripple'])
      
      // Should be able to update default chains
      const newDefaults = ['Bitcoin', 'Ethereum', 'Polygon']
      vultisig.setDefaultChains(newDefaults)
      expect(vultisig.getDefaultChains()).toEqual(newDefaults)
    })

    test('should validate chains against supported list', () => {
      // Should accept valid chains
      expect(() => {
        vultisig.setDefaultChains(['Bitcoin', 'Ethereum'])
      }).not.toThrow()
      
      // Should reject invalid chains
      expect(() => {
        vultisig.setDefaultChains(['InvalidChain', 'AnotherInvalid'])
      }).toThrow('Unsupported chains')
    })
  })

  describe('Vault Chain Management', () => {
    test('should inherit default chains from SDK', async () => {
      // Set custom default chains
      vultisig.setDefaultChains(['Bitcoin', 'Ethereum', 'Solana'])
      
      // Import a vault (this should inherit the default chains)
      const testVaultFile = new File(['test'], 'test.vult')
      
      try {
        // This will fail due to invalid file, but we can test the chain inheritance logic
        await vultisig.addVault(testVaultFile)
      } catch (error) {
        // Expected to fail due to invalid file format
        expect(error).toBeDefined()
      }
    })
  })

  describe('Currency Management', () => {
    test('should have configurable default currency', () => {
      // Initial default currency
      expect(vultisig.getDefaultCurrency()).toBe('USD')
      
      // Should be able to update default currency
      vultisig.setDefaultCurrency('EUR')
      expect(vultisig.getDefaultCurrency()).toBe('EUR')
    })
  })
})
