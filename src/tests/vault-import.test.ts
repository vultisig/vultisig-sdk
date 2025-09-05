import { readFileSync } from 'fs'
import { join } from 'path'
import { vi } from 'vitest'

import { VaultImportError } from '../vault/VaultError'
import { VaultManager } from '../vault/VaultManager'
import { FastVaultClient } from '../server/FastVaultClient'

describe('Vault Import Tests', () => {
  const testVaultsDir = join(__dirname, 'vaults')

  test('should import vault and verify all details', async () => {
    // Load test vault file
    const vaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
    const vaultBuffer = readFileSync(vaultPath)
    const vaultFile = new File([vaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
    ;(vaultFile as any).buffer = vaultBuffer

    // Import vault with password
    const vaultInstance = await VaultManager.add(vaultFile, 'Password123!')
    const vault = vaultInstance.data

    // Verify vault properties
    expect(vault.name).toBe('TestFastVault')
    expect(vault.signers).toHaveLength(2)
    expect(vault.publicKeys.ecdsa).toBe('03ac0f333fc5d22f929e013be80988f57a56837db64d968c126ca4c943984744fd')
    expect(vault.publicKeys.eddsa).toBe('dff9b5b456eadcbd99366fd691f50f865a26df433f9cbffe1b6f319ecadb8308')
    expect(vault.libType).toBe('DKLS')
    expect(vault.isBackedUp).toBe(true)
    expect(vault.threshold).toBe(2)

    // Verify vault details
    const details = await VaultManager.getVaultDetails(vault, 'Password123!')
    expect(details.name).toBe('TestFastVault')
    expect(details.securityType).toBe('fast') // Server validation succeeds, so classified as fast vault
    expect(details.threshold).toBe(2)
    expect(details.participants).toBe(2)
    expect(details.isBackedUp).toBe(true)

    // Verify validation
    const validation = VaultManager.validateVault(vault)
    expect(validation.valid).toBe(true)
    expect(validation.errors).toHaveLength(0)
  })

  test('should handle encrypted vault without password', async () => {
    const vaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
    const vaultBuffer = readFileSync(vaultPath)
    const vaultFile = new File([vaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
    ;(vaultFile as any).buffer = vaultBuffer

    await expect(VaultManager.add(vaultFile)).rejects.toThrow(VaultImportError)
  })

  test('should handle invalid vault data', async () => {
    const invalidData = Buffer.from('invalid vault data')
    const invalidFile = new File([invalidData], 'invalid.vult')

    await expect(VaultManager.add(invalidFile)).rejects.toThrow(VaultImportError)
  })

  test('should import unencrypted vault without password', async () => {
    const vaultPath = join(testVaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
    const vaultBuffer = readFileSync(vaultPath)
    const vaultFile = new File([vaultBuffer], 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
    ;(vaultFile as any).buffer = vaultBuffer

    const vaultInstance = await VaultManager.add(vaultFile)
    const vault = vaultInstance.data

    expect(vault.name).toBe('TestSecureVault')
    expect(vault.signers).toHaveLength(2)
    expect(vault.libType).toBe('DKLS')
    expect(vault.isBackedUp).toBe(true)
  })

  test('should handle wrong password for encrypted vault', async () => {
    const vaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
    const vaultBuffer = readFileSync(vaultPath)
    const vaultFile = new File([vaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
    ;(vaultFile as any).buffer = vaultBuffer

    await expect(VaultManager.add(vaultFile, 'WrongPassword')).rejects.toThrow(VaultImportError)
  })

  test('should only classify as fast vault if found on server (no fallbacks)', async () => {
    // Spy on the FastVaultClient.getVault method to verify it's called
    const getVaultSpy = vi.spyOn(FastVaultClient.prototype, 'getVault')

    // Load test fast vault file
    const vaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
    const vaultBuffer = readFileSync(vaultPath)
    const vaultFile = new File([vaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
    ;(vaultFile as any).buffer = vaultBuffer

    // Import vault with correct password
    const vaultInstance = await VaultManager.add(vaultFile, 'Password123!')
    const vault = vaultInstance.data

    // Verify server validation was attempted (will fail due to test environment)
    expect(getVaultSpy).toHaveBeenCalledWith(
      '03ac0f333fc5d22f929e013be80988f57a56837db64d968c126ca4c943984744fd',
      'Password123!'
    )
    expect(getVaultSpy).toHaveBeenCalledTimes(1)

    // Since server validation succeeds, it should be classified as fast
    const securityType = await VaultManager.getSecurityType(vaultInstance, 'Password123!')
    expect(securityType).toBe('fast')

    // Verify vault details reflect fast vault type
    const details = await VaultManager.getVaultDetails(vault, 'Password123!')
    expect(details.securityType).toBe('fast')

    // Clean up spy
    getVaultSpy.mockRestore()
  })
})
