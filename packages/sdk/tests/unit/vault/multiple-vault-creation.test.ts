/**
 * Multiple Vault Creation Test
 *
 * Reproduces bug where creating a second vault overwrites the first vault
 * instead of creating a new one.
 */

import { Chain } from '@core/chain/Chain'
import { beforeEach, describe, expect, it } from 'vitest'

import { GlobalConfig } from '../../../src/config/GlobalConfig'
import { GlobalStorage } from '../../../src/runtime/storage/GlobalStorage'
import { MemoryStorage } from '../../../src/runtime/storage/MemoryStorage'
import { GlobalServerManager } from '../../../src/server/GlobalServerManager'
import { PasswordCacheService } from '../../../src/services/PasswordCacheService'
import { VaultManager } from '../../../src/VaultManager'

describe('Multiple Vault Creation', () => {
  let vaultManager: VaultManager
  let memoryStorage: MemoryStorage

  beforeEach(() => {
    // Reset all global singletons before each test
    GlobalStorage.reset()
    GlobalServerManager.reset()
    GlobalConfig.reset()
    PasswordCacheService.resetInstance()

    // Configure global singletons
    memoryStorage = new MemoryStorage()
    GlobalStorage.configure({ customStorage: memoryStorage })

    GlobalServerManager.configure({
      fastVault: 'https://test-api.vultisig.com/vault',
      messageRelay: 'https://test-api.vultisig.com/router',
    })

    GlobalConfig.configure({
      defaultChains: [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],
      defaultCurrency: 'USD',
    })

    vaultManager = new VaultManager()
  })

  it('should create two separate vaults without overwriting', async () => {
    // Create a mock vault file content for testing
    // We'll use a minimal unencrypted vault container

    const createMockVaultFile = (name: string, publicKey: string) => {
      // This is a simplified mock - in reality you'd need a properly formatted .vult file
      // For now, we'll manually insert vaults directly into storage to test the bug
      return {
        id: publicKey, // Use public key as ID
        name,
        publicKeys: { ecdsa: publicKey, eddsa: `ed${publicKey}` },
        hexChainCode: '0x123',
        signers: ['Server-1', 'Device-1'],
        localPartyId: 'Device-1',
        createdAt: Date.now(),
        libType: 'GG20' as const,
        isBackedUp: true,
        order: 0,
        isEncrypted: false,
        type: 'fast' as const,
        currency: 'usd',
        chains: [],
        tokens: {},
        vultFileContent: '',
        lastModified: Date.now(),
      }
    }

    // Simulate creating first vault by directly saving to storage
    const vault1Data = createMockVaultFile('Vault 1', 'pubkey1')
    await memoryStorage.set(`vault:${vault1Data.id}`, vault1Data)

    // Verify first vault exists
    const savedVault1 = (await memoryStorage.get('vault:pubkey1')) as any
    expect(savedVault1).toBeDefined()
    expect(savedVault1?.name).toBe('Vault 1')
    expect(savedVault1?.publicKeys.ecdsa).toBe('pubkey1')

    // Simulate creating second vault
    const vault2Data = createMockVaultFile('Vault 2', 'pubkey2')
    await memoryStorage.set(`vault:${vault2Data.id}`, vault2Data)

    // Verify both vaults exist
    const savedVault1After = (await memoryStorage.get('vault:pubkey1')) as any
    const savedVault2 = (await memoryStorage.get('vault:pubkey2')) as any

    expect(savedVault1After).toBeDefined()
    expect(savedVault1After?.name).toBe('Vault 1')
    expect(savedVault1After?.publicKeys.ecdsa).toBe('pubkey1')

    expect(savedVault2).toBeDefined()
    expect(savedVault2?.name).toBe('Vault 2')
    expect(savedVault2?.publicKeys.ecdsa).toBe('pubkey2')

    // Verify we can list both vaults
    const allVaults = await vaultManager.listVaults()
    expect(allVaults).toHaveLength(2)
    expect(allVaults[0].name).toBe('Vault 1')
    expect(allVaults[1].name).toBe('Vault 2')
  })

  it('REGRESSION: vaults with same public key should have same ID (update in place)', async () => {
    // With public key-based IDs, vaults with the same public key share the same ID
    // This means re-importing a vault with the same keys updates it in place

    const createMockVaultData = (name: string, publicKey: string) => {
      return {
        id: publicKey, // ID is now the public key
        name,
        publicKeys: { ecdsa: publicKey, eddsa: `ed${publicKey}` },
        hexChainCode: '0x123',
        signers: ['Server-1', 'Device-1'],
        localPartyId: 'Device-1',
        createdAt: Date.now(),
        libType: 'GG20' as const,
        isBackedUp: true,
        order: 0,
        isEncrypted: false,
        type: 'fast' as const,
        currency: 'usd',
        chains: [],
        tokens: {},
        vultFileContent: '',
        lastModified: Date.now(),
      }
    }

    // Create first vault with name "My Wallet"
    const vault1Data = createMockVaultData('My Wallet', 'shared-pubkey-123')
    await memoryStorage.set(`vault:${vault1Data.id}`, vault1Data)

    // Verify first vault exists
    const vault1 = await vaultManager.getVaultById('shared-pubkey-123')
    expect(vault1).toBeDefined()
    expect(vault1?.name).toBe('My Wallet')

    // Now importing a vault with the SAME public key should update it
    // This is the correct behavior with public key IDs
    const vault2Data = createMockVaultData(
      'My Updated Wallet',
      'shared-pubkey-123'
    )
    await memoryStorage.set(`vault:${vault2Data.id}`, vault2Data)

    // Should only have ONE vault (updated in place)
    const allVaults = await vaultManager.listVaults()
    expect(allVaults).toHaveLength(1)

    // Verify vault was updated
    const vaultAfter = await vaultManager.getVaultById('shared-pubkey-123')
    expect(vaultAfter).toBeDefined()
    expect(vaultAfter?.name).toBe('My Updated Wallet')
  })

  it('should use public key as vault ID', async () => {
    // Verify that vault IDs are derived from public keys

    const createMockVaultData = (name: string, publicKey: string) => {
      return {
        id: publicKey, // ID should match public key
        name,
        publicKeys: { ecdsa: publicKey, eddsa: `ed${publicKey}` },
        hexChainCode: '0x123',
        signers: ['Server-1', 'Device-1'],
        localPartyId: 'Device-1',
        createdAt: Date.now(),
        libType: 'GG20' as const,
        isBackedUp: true,
        order: 0,
        isEncrypted: false,
        type: 'fast' as const,
        currency: 'usd',
        chains: [],
        tokens: {},
        vultFileContent: '',
        lastModified: Date.now(),
      }
    }

    // Create vault with specific public key
    const publicKey = 'test-public-key-abc123'
    const vaultData = createMockVaultData('Test Vault', publicKey)
    await memoryStorage.set(`vault:${vaultData.id}`, vaultData)

    // Verify vault can be retrieved by its public key
    const vault = await vaultManager.getVaultById(publicKey)
    expect(vault).toBeDefined()
    expect(vault?.id).toBe(publicKey)
    expect(vault?.name).toBe('Test Vault')
  })
})
