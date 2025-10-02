/**
 * Multi-Vault Tests
 * Tests vault management operations with multiple vaults
 */

import { readFileSync } from 'fs'
import { join } from 'path'

import { Vultisig } from '../index'

describe('Multi-Vault Tests', () => {
  let vultisig: Vultisig

  beforeEach(async () => {
    vultisig = new Vultisig()
    await vultisig.clearVaults()
  })

  afterEach(async () => {
    await vultisig.clearVaults()
  })

  describe('Active Vault Management', () => {
    test('should set last imported/created vault as active', async () => {
      // Import first vault
      const vault1Path = join(__dirname, 'vaults', 'TestFastVault-44fd-share2of2-Password123!.vult')
      const vault1Buffer = readFileSync(vault1Path)
      const vault1File = new File([vault1Buffer], 'vault1.vult')
      ;(vault1File as any).buffer = vault1Buffer
      const vault1 = await vultisig.addVault(vault1File, 'Password123!')
      
      expect(vultisig.getActiveVault()).toBe(vault1)
      
      // Import second vault
      const vault2Path = join(__dirname, 'vaults', 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const vault2Buffer = readFileSync(vault2Path)
      const vault2File = new File([vault2Buffer], 'vault2.vult')
      ;(vault2File as any).buffer = vault2Buffer
      const vault2 = await vultisig.addVault(vault2File)
      
      // Second vault should now be active
      expect(vultisig.getActiveVault()).toBe(vault2)
      expect(vultisig.getActiveVault()?.summary().name).toBe('TestSecureVault')
    })

    test('should allow switching between vaults', async () => {
      // Import two vaults
      const vault1Path = join(__dirname, 'vaults', 'TestFastVault-44fd-share2of2-Password123!.vult')
      const vault1Buffer = readFileSync(vault1Path)
      const vault1File = new File([vault1Buffer], 'vault1.vult')
      ;(vault1File as any).buffer = vault1Buffer
      const vault1 = await vultisig.addVault(vault1File, 'Password123!')
      
      const vault2Path = join(__dirname, 'vaults', 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const vault2Buffer = readFileSync(vault2Path)
      const vault2File = new File([vault2Buffer], 'vault2.vult')
      ;(vault2File as any).buffer = vault2Buffer
      const vault2 = await vultisig.addVault(vault2File)
      
      // vault2 is active (last imported)
      expect(vultisig.getActiveVault()).toBe(vault2)
      
      // Switch to vault1
      vultisig.setActiveVault(vault1)
      expect(vultisig.getActiveVault()).toBe(vault1)
      expect(vultisig.getActiveVault()?.summary().name).toBe('TestFastVault')
      
      // Switch back to vault2
      vultisig.setActiveVault(vault2)
      expect(vultisig.getActiveVault()).toBe(vault2)
      expect(vultisig.getActiveVault()?.summary().name).toBe('TestSecureVault')
    })
  })

  describe('Vault Storage Management', () => {
    test('should list multiple vaults correctly', async () => {
      // Should start with no vaults
      let vaults = await vultisig.listVaults()
      expect(vaults).toHaveLength(0)
      
      // Import first vault
      const vault1Path = join(__dirname, 'vaults', 'TestFastVault-44fd-share2of2-Password123!.vult')
      const vault1Buffer = readFileSync(vault1Path)
      const vault1File = new File([vault1Buffer], 'vault1.vult')
      ;(vault1File as any).buffer = vault1Buffer
      await vultisig.addVault(vault1File, 'Password123!')
      
      vaults = await vultisig.listVaults()
      expect(vaults).toHaveLength(1)
      expect(vaults[0].name).toBe('TestFastVault')
      
      // Import second vault
      const vault2Path = join(__dirname, 'vaults', 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const vault2Buffer = readFileSync(vault2Path)
      const vault2File = new File([vault2Buffer], 'vault2.vult')
      ;(vault2File as any).buffer = vault2Buffer
      await vultisig.addVault(vault2File)
      
      vaults = await vultisig.listVaults()
      expect(vaults).toHaveLength(2)
      
      const vaultNames = vaults.map(v => v.name).sort()
      expect(vaultNames).toEqual(['TestFastVault', 'TestSecureVault'])
    })

    test('should delete specific vault and manage active state', async () => {
      // Import two vaults
      const vault1Path = join(__dirname, 'vaults', 'TestFastVault-44fd-share2of2-Password123!.vult')
      const vault1Buffer = readFileSync(vault1Path)
      const vault1File = new File([vault1Buffer], 'vault1.vult')
      ;(vault1File as any).buffer = vault1Buffer
      const vault1 = await vultisig.addVault(vault1File, 'Password123!')
      
      const vault2Path = join(__dirname, 'vaults', 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const vault2Buffer = readFileSync(vault2Path)
      const vault2File = new File([vault2Buffer], 'vault2.vult')
      ;(vault2File as any).buffer = vault2Buffer
      const vault2 = await vultisig.addVault(vault2File)
      
      // vault2 should be active (last imported)
      expect(vultisig.getActiveVault()).toBe(vault2)
      expect(await vultisig.listVaults()).toHaveLength(2)
      
      // Delete the active vault
      await vultisig.deleteVault(vault2)
      
      // Active vault should be cleared since we deleted it
      expect(vultisig.getActiveVault()).toBeNull()
      expect(await vultisig.listVaults()).toHaveLength(1)
      
      // Delete the remaining vault
      await vultisig.deleteVault(vault1)
      expect(await vultisig.listVaults()).toHaveLength(0)
      expect(vultisig.hasActiveVault()).toBe(false)
    })

    test('should clear all vaults', async () => {
      // Import multiple vaults
      const vault1Path = join(__dirname, 'vaults', 'TestFastVault-44fd-share2of2-Password123!.vult')
      const vault1Buffer = readFileSync(vault1Path)
      const vault1File = new File([vault1Buffer], 'vault1.vult')
      ;(vault1File as any).buffer = vault1Buffer
      await vultisig.addVault(vault1File, 'Password123!')
      
      const vault2Path = join(__dirname, 'vaults', 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const vault2Buffer = readFileSync(vault2Path)
      const vault2File = new File([vault2Buffer], 'vault2.vult')
      ;(vault2File as any).buffer = vault2Buffer
      await vultisig.addVault(vault2File)
      
      expect(await vultisig.listVaults()).toHaveLength(2)
      expect(vultisig.hasActiveVault()).toBe(true)
      
      // Clear all vaults
      await vultisig.clearVaults()
      
      expect(await vultisig.listVaults()).toHaveLength(0)
      expect(vultisig.hasActiveVault()).toBe(false)
      expect(vultisig.getActiveVault()).toBeNull()
    })
  })

  describe('Chain Management', () => {
    test('should have proper chain hierarchy', async () => {
      // Test supported chains (immutable)
      const supportedChains = vultisig.getSupportedChains()
      expect(supportedChains).toContain('Bitcoin')
      expect(supportedChains).toContain('Ethereum')
      expect(supportedChains).toContain('Solana')
      expect(supportedChains.length).toBeGreaterThan(25)
      
      // Test default chains (configurable)
      const defaultChains = vultisig.getDefaultChains()
      expect(defaultChains).toContain('Bitcoin')
      expect(defaultChains).toContain('Ethereum')
      
      // Should be able to update default chains
      const newDefaults = ['Bitcoin', 'Ethereum', 'Solana']
      vultisig.setDefaultChains(newDefaults)
      expect(vultisig.getDefaultChains()).toEqual(newDefaults)
    })

    test('should set default currency', async () => {
      expect(vultisig.getDefaultCurrency()).toBe('USD')
      
      vultisig.setDefaultCurrency('EUR')
      expect(vultisig.getDefaultCurrency()).toBe('EUR')
    })
  })

  describe('SDK Configuration', () => {
    test('should support custom configuration', () => {
      const customConfig = {
        defaultChains: ['Bitcoin', 'Ethereum'],
        defaultCurrency: 'EUR',
        serverEndpoints: {
          fastVault: 'https://custom-server.com',
          messageRelay: 'https://custom-relay.com'
        }
      }
      
      const customVultisig = new Vultisig(customConfig)
      
      expect(customVultisig.getDefaultChains()).toEqual(['Bitcoin', 'Ethereum'])
      expect(customVultisig.getDefaultCurrency()).toBe('EUR')
    })

    test('should auto-initialize on first vault operation', async () => {
      const vultisig = new Vultisig()
      
      // Should not be initialized initially
      expect(vultisig.isInitialized()).toBe(false)
      
      // Load test vault
      const vaultName = join(__dirname, 'vaults', 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const vaultBuffer = readFileSync(vaultName)
      const vaultFile = new File([vaultBuffer], 'vault.vult')
      ;(vaultFile as any).buffer = vaultBuffer
      
      // First vault operation should auto-initialize
      await vultisig.addVault(vaultFile)
      
      expect(vultisig.isInitialized()).toBe(true)
    })
  })
})
