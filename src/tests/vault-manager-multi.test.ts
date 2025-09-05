import { readFileSync } from 'fs'
import { join } from 'path'

import { VaultManager } from '../vault/VaultManager'

describe('Vault Manager Multi-Vault Tests', () => {
  const testVaultsDir = join(__dirname, 'vaults')

  beforeEach(async () => {
    await VaultManager.clear()
    VaultManager.init(null)
  })

  afterEach(async () => {
    await VaultManager.clear()
  })

  test('should add/remove vaults with different actives', async () => {
    // Initially no vaults
    expect((await VaultManager.list())).toHaveLength(0)
    expect(VaultManager.getActive()).toBe(null)

    // Add first vault
    const fastVaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
    const fastVaultBuffer = readFileSync(fastVaultPath)
    const fastVaultFile = new File([fastVaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
    ;(fastVaultFile as any).buffer = fastVaultBuffer

    const fastVault = await VaultManager.add(fastVaultFile, 'Password123!')

    // Should have 1 vault, but no active
    expect((await VaultManager.list())).toHaveLength(1)
    expect(VaultManager.getActive()).toBe(null)

    // Set first vault as active
    VaultManager.setActive(fastVault)
    expect(VaultManager.getActive()).toBe(fastVault)

    // Add second vault
    const secureVaultPath = join(testVaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
    const secureVaultBuffer = readFileSync(secureVaultPath)
    const secureVaultFile = new File([secureVaultBuffer], 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
    ;(secureVaultFile as any).buffer = secureVaultBuffer

    const secureVault = await VaultManager.add(secureVaultFile)

    // Should have 2 vaults, first still active
    expect((await VaultManager.list())).toHaveLength(2)
    expect(VaultManager.getActive()).toBe(fastVault)

    // Switch active to second vault
    VaultManager.setActive(secureVault)
    expect(VaultManager.getActive()).toBe(secureVault)

    // Remove first vault
    await VaultManager.remove(fastVault)

    // Should have 1 vault, second still active
    expect((await VaultManager.list())).toHaveLength(1)
    expect(VaultManager.getActive()).toBe(secureVault)

    // Remove second vault (active)
    await VaultManager.remove(secureVault)

    // Should have no vaults, no active
    expect((await VaultManager.list())).toHaveLength(0)
    expect(VaultManager.getActive()).toBe(null)
  })

  test('should handle multiple vaults with load() making them active', async () => {
    // Add first vault
    const fastVaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
    const fastVaultBuffer = readFileSync(fastVaultPath)
    const fastVaultFile = new File([fastVaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
    ;(fastVaultFile as any).buffer = fastVaultBuffer

    const fastVault = await VaultManager.add(fastVaultFile, 'Password123!')
    VaultManager.setActive(fastVault)

    // Add second vault and load() it (should make it active)
    const secureVaultPath = join(testVaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
    const secureVaultBuffer = readFileSync(secureVaultPath)
    const secureVaultFile = new File([secureVaultBuffer], 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
    ;(secureVaultFile as any).buffer = secureVaultBuffer

    const secureVault = await VaultManager.add(secureVaultFile)
    await VaultManager.load(secureVault)

    // Second vault should be active now
    expect(VaultManager.getActive()).toBe(secureVault)
    expect(VaultManager.getActive()).not.toBe(fastVault)
  })

  test('should clear all vaults', async () => {
    // Add vaults
    const fastVaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
    const fastVaultBuffer = readFileSync(fastVaultPath)
    const fastVaultFile = new File([fastVaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
    ;(fastVaultFile as any).buffer = fastVaultBuffer

    const fastVault = await VaultManager.add(fastVaultFile, 'Password123!')
    VaultManager.setActive(fastVault)

    expect((await VaultManager.list())).toHaveLength(1)
    expect(VaultManager.getActive()).toBe(fastVault)

    // Clear all vaults
    await VaultManager.clear()

    expect((await VaultManager.list())).toHaveLength(0)
    expect(VaultManager.getActive()).toBe(null)
  })

  test('should list vaults correctly', async () => {
    // Initially no vaults
    expect((await VaultManager.list())).toHaveLength(0)

    // Add vault
    const fastVaultPath = join(testVaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult')
    const fastVaultBuffer = readFileSync(fastVaultPath)
    const fastVaultFile = new File([fastVaultBuffer], 'TestFastVault-44fd-share2of2-Password123!.vult')
    ;(fastVaultFile as any).buffer = fastVaultBuffer

    await VaultManager.add(fastVaultFile, 'Password123!')

    const vaultList = await VaultManager.list()
    expect(vaultList).toHaveLength(1)
    expect(vaultList[0].name).toContain('TestFastVault')
    expect(vaultList[0].type).toBe('fast')
    expect(vaultList[0].totalSigners).toBe(2)
  })
})
