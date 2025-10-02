/**
 * Single Vault Tests
 * Tests basic vault operations with a single vault instance
 */

import { readFileSync } from 'fs'
import { join } from 'path'

import { Vultisig } from '../index'

describe('Single Vault Tests', () => {
  let vultisig: Vultisig

  beforeEach(async () => {
    vultisig = new Vultisig()
    await vultisig.clearVaults()
  })

  afterEach(async () => {
    await vultisig.clearVaults()
  })

  describe('Vault Import and Basic Operations', () => {
    test('should import encrypted vault and verify properties', async () => {
      // Load encrypted test vault
      const vaultName = join(__dirname, 'vaults', 'TestFastVault-44fd-share2of2-Password123!.vult')
      const vaultBuffer = readFileSync(vaultName)
      const vaultFile = new File([vaultBuffer], 'TestFastVault.vult')
      ;(vaultFile as any).buffer = vaultBuffer

      // Import vault with password
      const vault = await vultisig.addVault(vaultFile, 'Password123!')

      // Verify vault properties
      const summary = vault.summary()
      expect(summary.name).toBe('TestFastVault')
      expect(summary.type).toBe('fast')
      expect(vault.data.publicKeys.ecdsa).toBe('03ac0f333fc5d22f929e013be80988f57a56837db64d968c126ca4c943984744fd')
      expect(vault.data.publicKeys.eddsa).toBe('dff9b5b456eadcbd99366fd691f50f865a26df433f9cbffe1b6f319ecadb8308')
      expect(vault.data.signers).toHaveLength(2)
      expect(vault.data.libType).toBe('DKLS')
      expect(vault.data.threshold).toBe(2)

      // Should be automatically set as active
      expect(vultisig.hasActiveVault()).toBe(true)
      expect(vultisig.getActiveVault()).toBe(vault)
    })

    test('should import unencrypted vault without password', async () => {
      // Load unencrypted test vault
      const vaultName = join(__dirname, 'vaults', 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const vaultBuffer = readFileSync(vaultName)
      const vaultFile = new File([vaultBuffer], 'TestSecureVault.vult')
      ;(vaultFile as any).buffer = vaultBuffer

      // Import vault without password
      const vault = await vultisig.addVault(vaultFile)

      // Verify vault properties
      const summary = vault.summary()
      expect(summary.name).toBe('TestSecureVault')
      expect(summary.type).toBe('secure')
      expect(vault.data.signers).toHaveLength(2)
      expect(vault.data.libType).toBe('DKLS')

      // Should be automatically set as active
      expect(vultisig.hasActiveVault()).toBe(true)
      expect(vultisig.getActiveVault()).toBe(vault)
    })
  })

  describe('Address Derivation', () => {
    test('should derive address for bitcoin', async () => {
      // Import test vault
      const vaultName = join(__dirname, 'vaults', 'TestFastVault-44fd-share2of2-Password123!.vult')
      const vaultBuffer = readFileSync(vaultName)
      const vaultFile = new File([vaultBuffer], 'TestFastVault.vult')
      ;(vaultFile as any).buffer = vaultBuffer
      const vault = await vultisig.addVault(vaultFile, 'Password123!')

      // Derive bitcoin address
      const btcAddress = await vault.address('bitcoin')
      expect(btcAddress).toBe('bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9')
    })

    test('should derive addresses for multiple chains', async () => {
      // Import test vault
      const vaultName = join(__dirname, 'vaults', 'TestFastVault-44fd-share2of2-Password123!.vult')
      const vaultBuffer = readFileSync(vaultName)
      const vaultFile = new File([vaultBuffer], 'TestFastVault.vult')
      ;(vaultFile as any).buffer = vaultBuffer
      const vault = await vultisig.addVault(vaultFile, 'Password123!')

      // Test multiple chain addresses
      const expectedAddresses = {
        bitcoin: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
        ethereum: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
        thorchain: 'thor1nuwfr59wyn6da6v5ktxsa32v2t6u2q4veg9awu',
        solana: 'G5Jm9g1NH1xprPz3ZpnNmF8Wkz2F6YUhkxpf432mRefR'
      }

      for (const [chain, expectedAddress] of Object.entries(expectedAddresses)) {
        const address = await vault.address(chain)
        expect(address).toBe(expectedAddress)
      }
    })
  })

  describe('File Operations', () => {
    test('should detect encrypted vault files', async () => {
      const encryptedPath = join(__dirname, 'vaults', 'TestFastVault-44fd-share2of2-Password123!.vult')
      const encryptedBuffer = readFileSync(encryptedPath)
      const encryptedFile = new File([encryptedBuffer], 'encrypted.vult')
      ;(encryptedFile as any).buffer = encryptedBuffer
      
      const isEncrypted = await vultisig.isVaultFileEncrypted(encryptedFile)
      expect(isEncrypted).toBe(true)
    })

    test('should detect unencrypted vault files', async () => {
      const unencryptedPath = join(__dirname, 'vaults', 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const unencryptedBuffer = readFileSync(unencryptedPath)
      const unencryptedFile = new File([unencryptedBuffer], 'unencrypted.vult')
      ;(unencryptedFile as any).buffer = unencryptedBuffer
      
      const isEncrypted = await vultisig.isVaultFileEncrypted(unencryptedFile)
      expect(isEncrypted).toBe(false)
    })
  })

  describe('Error Handling', () => {
    test('should handle encrypted vault without password', async () => {
      const vaultName = join(__dirname, 'vaults', 'TestFastVault-44fd-share2of2-Password123!.vult')
      const vaultBuffer = readFileSync(vaultName)
      const vaultFile = new File([vaultBuffer], 'TestFastVault.vult')
      ;(vaultFile as any).buffer = vaultBuffer

      // Should throw error when password is required but not provided
      await expect(vultisig.addVault(vaultFile)).rejects.toThrow()
    })

    test('should handle wrong password for encrypted vault', async () => {
      const vaultName = join(__dirname, 'vaults', 'TestFastVault-44fd-share2of2-Password123!.vult')
      const vaultBuffer = readFileSync(vaultName)
      const vaultFile = new File([vaultBuffer], 'TestFastVault.vult')
      ;(vaultFile as any).buffer = vaultBuffer

      // Should throw error with wrong password
      await expect(vultisig.addVault(vaultFile, 'WrongPassword')).rejects.toThrow()
    })

    test('should handle invalid vault data', async () => {
      const invalidData = Buffer.from('invalid vault data')
      const invalidFile = new File([invalidData], 'invalid.vult')
      ;(invalidFile as any).buffer = invalidData

      await expect(vultisig.addVault(invalidFile)).rejects.toThrow()
    })
  })
})
