/**
 * Vault Address Tests
 * Tests Vault's address() method for various chains
 */

import { readFileSync } from 'fs'
import { join } from 'path'

import { VaultManager } from '../vault/VaultManager'
import { VultisigSDK } from '../VultisigSDK'

type TestVaultData = {
  filename: string
  vault: {
    name: string
    localPartyId: string
    signers: string[]
    libType: string | number
    publicKeys: {
      ecdsa: string
      eddsa: string
    }
    hexChainCode: string
    createdAt: number
    isBackedUp: boolean
  }
  addresses: Record<string, string>
  decodedAt: string
}

describe('Vault Address Tests', () => {
  let sdk: VultisigSDK

  beforeAll(async () => {
    // Initialize SDK with real WalletCore WASM
    // WASM file loading is handled globally by vitest.setup.ts
    // VaultManager is automatically initialized by sdk.initialize()
    sdk = new VultisigSDK()
    await sdk.initialize()
  }, 120000) // 2 minute timeout for WASM initialization

  beforeEach(async () => {
    // Clear any existing data
    await VaultManager.clear()
  })

  afterEach(async () => {
    // Clean up after each test
    await VaultManager.clear()
  })

  describe('vault.address()', () => {
    const testVaultsDir = join(__dirname, 'vaults')

    test('should derive address for bitcoin', async () => {
      // Load test vault
      const vaultFilePath = join(
        testVaultsDir,
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      const vaultFileBuffer = readFileSync(vaultFilePath)
      const expectedDataPath = join(
        testVaultsDir,
        'vault-details-TestFastVault-44fd-share2of2-Password123!.json'
      )
      const expectedData: TestVaultData = JSON.parse(
        readFileSync(expectedDataPath, 'utf-8')
      )

      // Create File object (Node.js compatible)
      const vaultFileObj = new File(
        [vaultFileBuffer],
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      // For Node.js testing, attach the buffer directly
      ;(vaultFileObj as any).buffer = vaultFileBuffer

      // Import vault
      const vaultInstance = await VaultManager.add(vaultFileObj, 'Password123!')

      // Test REAL address derivation for bitcoin
      const bitcoinAddress = await vaultInstance.address('bitcoin')

      // Verify perfect match against expected address
      expect(bitcoinAddress).toBe(expectedData.addresses.Bitcoin)
    })

    test('should derive addresses for all expected chains', async () => {
      // Load test vault
      const vaultFilePath = join(
        testVaultsDir,
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      const vaultFileBuffer = readFileSync(vaultFilePath)
      const expectedDataPath = join(
        testVaultsDir,
        'vault-details-TestFastVault-44fd-share2of2-Password123!.json'
      )
      const expectedData: TestVaultData = JSON.parse(
        readFileSync(expectedDataPath, 'utf-8')
      )

      // Create File object (Node.js compatible)
      const vaultFileObj = new File(
        [vaultFileBuffer],
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      // For Node.js testing, attach the buffer directly
      ;(vaultFileObj as any).buffer = vaultFileBuffer

      // Import vault
      const vaultInstance = await VaultManager.add(
        vaultFileObj,
        'Password123!'
      )

      // Test REAL address derivation for all chains
      const chains = Object.keys(expectedData.addresses)
      const addresses = await vaultInstance.addresses(chains.map(c => c.toLowerCase()))

      // Verify all addresses match expected data
      for (const chain of chains) {
        const chainKey = chain.toLowerCase()
        expect(addresses[chainKey]).toBe(expectedData.addresses[chain as keyof typeof expectedData.addresses])
      }

      // Verify all chains are present
      expect(Object.keys(addresses)).toHaveLength(chains.length)
    })
  })
})
