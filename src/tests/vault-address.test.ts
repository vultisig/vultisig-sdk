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
    sdk = new VultisigSDK()
    await sdk.initialize()

    // Initialize VaultManager with the SDK instance
    VaultManager.init(sdk)
  }, 60000) // 60 second timeout for WASM initialization

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

      // Create File object
      const vaultFileObj = new File(
        [vaultFileBuffer],
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      // Use the mock File implementation from vitest setup
      Object.defineProperty(vaultFileObj, 'arrayBuffer', {
        value: () => Promise.resolve(vaultFileBuffer.buffer.slice(vaultFileBuffer.byteOffset, vaultFileBuffer.byteOffset + vaultFileBuffer.byteLength)),
        writable: true
      })

      // Import vault
      const vaultInstance = await VaultManager.add(vaultFileObj, 'Password123!')

      // Test address derivation for bitcoin
      const bitcoinAddress = await vaultInstance.address('bitcoin')

      // Verify perfect match against expected address
      expect(bitcoinAddress).toBe(expectedData.addresses.Bitcoin)
    })

    test('should derive addresses for all expecteddata chains', async () => {
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

      // Create File object
      const vaultFileObj = new File(
        [vaultFileBuffer],
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      // Use the mock File implementation from vitest setup
      Object.defineProperty(vaultFileObj, 'arrayBuffer', {
        value: () => Promise.resolve(vaultFileBuffer.buffer.slice(vaultFileBuffer.byteOffset, vaultFileBuffer.byteOffset + vaultFileBuffer.byteLength)),
        writable: true
      })

      // Import vault
      const vaultInstance = await VaultManager.add(
        vaultFileObj,
        'Password123!'
      )

      // Test all chains found in expected data using .addresses()
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
