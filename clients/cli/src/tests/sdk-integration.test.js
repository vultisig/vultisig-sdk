/**
 * SDK Integration Tests
 * Tests that CLI properly integrates with the Vultisig SDK
 */

const fs = require('fs')
const path = require('path')

// Load test setup
require('./setup')
const { VultisigSDK, vaultsDir, expectedAddresses } = require('./setup')

describe('SDK Integration Tests', () => {
  describe('SDK API Usage', () => {
    test('should create Vultisig SDK instance', () => {
      const sdk = new VultisigSDK({
        defaultChains: ['bitcoin', 'ethereum', 'solana'],
        defaultCurrency: 'USD',
      })

      expect(sdk).toBeDefined()
      expect(typeof sdk.addVault).toBe('function')
      expect(typeof sdk.getActiveVault).toBe('function')
      expect(typeof sdk.listVaults).toBe('function')
    })

    test('should load unencrypted vault using SDK API', async () => {
      const sdk = new VultisigSDK()

      const vaultPath = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const fileBuffer = fs.readFileSync(vaultPath)
      const file = new File([fileBuffer], path.basename(vaultPath))
      file.buffer = fileBuffer

      const vault = await sdk.addVault(file)

      expect(vault).toBeDefined()
      expect(typeof vault.address).toBe('function')
      expect(typeof vault.summary).toBe('function')

      const summary = vault.summary()
      expect(summary.name).toBe('TestSecureVault')
      expect(summary.type).toBe('secure')
    })

    test('should load encrypted vault using SDK API', async () => {
      const sdk = new VultisigSDK()

      const vaultPath = path.join(
        vaultsDir,
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      const fileBuffer = fs.readFileSync(vaultPath)
      const file = new File([fileBuffer], path.basename(vaultPath))
      file.buffer = fileBuffer

      const vault = await sdk.addVault(file, 'Password123!')

      expect(vault).toBeDefined()

      const summary = vault.summary()
      expect(summary.name).toBe('TestFastVault')
      expect(summary.type).toBe('fast')
    })

    test('should derive addresses using vault.address() method', async () => {
      const sdk = new VultisigSDK()

      const vaultPath = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const fileBuffer = fs.readFileSync(vaultPath)
      const file = new File([fileBuffer], path.basename(vaultPath))
      file.buffer = fileBuffer

      const vault = await sdk.addVault(file)
      const expected =
        expectedAddresses['TestSecureVault-cfa0-share2of2-NoPassword.vult']

      // Test Bitcoin
      const btcAddress = await vault.address('bitcoin')
      expect(btcAddress).toBe(expected.Bitcoin)

      // Test Ethereum
      const ethAddress = await vault.address('ethereum')
      expect(ethAddress).toBe(expected.Ethereum)

      // Test Solana
      const solAddress = await vault.address('solana')
      expect(solAddress).toBe(expected.Solana)
    })

    test('should handle multiple vaults correctly', async () => {
      const sdk = new VultisigSDK()

      // Load first vault
      const vault1Path = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const file1Buffer = fs.readFileSync(vault1Path)
      const file1 = new File([file1Buffer], path.basename(vault1Path))
      file1.buffer = file1Buffer

      const vault1 = await sdk.addVault(file1)
      expect(vault1.summary().name).toBe('TestSecureVault')

      // Clear vaults
      await sdk.clearVaults()

      // Load second vault
      const vault2Path = path.join(
        vaultsDir,
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      const file2Buffer = fs.readFileSync(vault2Path)
      const file2 = new File([file2Buffer], path.basename(vault2Path))
      file2.buffer = file2Buffer

      const vault2 = await sdk.addVault(file2, 'Password123!')
      expect(vault2.summary().name).toBe('TestFastVault')

      // Should have switched active vault
      const activeVault = sdk.getActiveVault()
      expect(activeVault.summary().name).toBe('TestFastVault')
    })
  })

  describe('WASM Integration Tests', () => {
    test('should initialize WalletCore correctly', async () => {
      const sdk = new VultisigSDK()

      const vaultPath = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const fileBuffer = fs.readFileSync(vaultPath)
      const file = new File([fileBuffer], path.basename(vaultPath))
      file.buffer = fileBuffer

      const vault = await sdk.addVault(file)

      // Vault should have WalletCore initialized
      expect(vault.walletCore).toBeTruthy()

      // Address derivation should work
      const address = await vault.address('bitcoin')
      expect(address).toBeTruthy()
      expect(address.startsWith('bc1')).toBe(true)
    })

    test('should handle all supported WASM operations', async () => {
      const sdk = new VultisigSDK()

      const vaultPath = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const fileBuffer = fs.readFileSync(vaultPath)
      const file = new File([fileBuffer], path.basename(vaultPath))
      file.buffer = fileBuffer

      const vault = await sdk.addVault(file)

      // Test different signature algorithms
      const ecdsaAddress = await vault.address('bitcoin') // ECDSA
      const eddsaAddress = await vault.address('solana') // EdDSA

      expect(ecdsaAddress).toBeTruthy()
      expect(eddsaAddress).toBeTruthy()
      expect(ecdsaAddress).not.toBe(eddsaAddress)
    })
  })

  describe('Performance and Caching Tests', () => {
    test('should cache addresses for performance', async () => {
      const sdk = new VultisigSDK()

      const vaultPath = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const fileBuffer = fs.readFileSync(vaultPath)
      const file = new File([fileBuffer], path.basename(vaultPath))
      file.buffer = fileBuffer

      const vault = await sdk.addVault(file)

      // First call - should derive
      const start1 = Date.now()
      const address1 = await vault.address('bitcoin')
      const time1 = Date.now() - start1

      // Second call - should be cached
      const start2 = Date.now()
      const address2 = await vault.address('bitcoin')
      const time2 = Date.now() - start2

      expect(address1).toBe(address2)
      expect(time2).toBeLessThan(time1) // Cached should be faster
      expect(time2).toBeLessThan(5) // Cached should be very fast
    })

    test('should derive multiple addresses efficiently', async () => {
      const sdk = new VultisigSDK()

      const vaultPath = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const fileBuffer = fs.readFileSync(vaultPath)
      const file = new File([fileBuffer], path.basename(vaultPath))
      file.buffer = fileBuffer

      const vault = await sdk.addVault(file)

      const startTime = Date.now()
      const addresses = await vault.addresses(['bitcoin', 'ethereum', 'solana'])
      const totalTime = Date.now() - startTime

      expect(Object.keys(addresses)).toHaveLength(3)
      expect(totalTime).toBeLessThan(5000) // Should complete within 5 seconds

      const expected =
        expectedAddresses['TestSecureVault-cfa0-share2of2-NoPassword.vult']
      expect(addresses.bitcoin).toBe(expected.Bitcoin)
      expect(addresses.ethereum).toBe(expected.Ethereum)
      expect(addresses.solana).toBe(expected.Solana)
    })
  })

  describe('Error Handling Tests', () => {
    test('should handle invalid vault files gracefully', async () => {
      const sdk = new VultisigSDK()

      // Create invalid file
      const invalidFile = new File(['invalid content'], 'invalid.vult')
      invalidFile.buffer = Buffer.from('invalid content')

      await expect(sdk.addVault(invalidFile)).rejects.toThrow()
    })

    test('should handle missing passwords for encrypted vaults', async () => {
      const sdk = new VultisigSDK()

      const vaultPath = path.join(
        vaultsDir,
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      const fileBuffer = fs.readFileSync(vaultPath)
      const file = new File([fileBuffer], path.basename(vaultPath))
      file.buffer = fileBuffer

      // Should fail without password
      await expect(sdk.addVault(file)).rejects.toThrow()
    })

    test('should handle wrong passwords for encrypted vaults', async () => {
      const sdk = new VultisigSDK()

      const vaultPath = path.join(
        vaultsDir,
        'TestFastVault-44fd-share2of2-Password123!.vult'
      )
      const fileBuffer = fs.readFileSync(vaultPath)
      const file = new File([fileBuffer], path.basename(vaultPath))
      file.buffer = fileBuffer

      // Should fail with wrong password
      await expect(sdk.addVault(file, 'wrongpassword')).rejects.toThrow()
    })
  })
})
