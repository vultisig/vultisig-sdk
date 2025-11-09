/**
 * Regression Tests
 * Tests to prevent specific issues from returning
 */

const { execSync } = require('child_process')
const path = require('path')

// Load test setup
require('./setup')
const { expectedAddresses, expectedVaultData, vaultsDir } = require('./setup')

const CLI_PATH = path.resolve(__dirname, '../../bin/vultisig')
const TIMEOUT = 30000

describe('Regression Tests', () => {
  describe('API Compatibility', () => {
    test('should use new Vultisig SDK API (not old VaultManager)', () => {
      const vaultName = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const output = execSync(
        `${CLI_PATH} address --network bitcoin --vault "${vaultName}"`,
        {
          encoding: 'utf8',
          timeout: TIMEOUT,
        }
      )

      // Should NOT contain old VaultManager patterns
      expect(output).not.toContain('VaultManager.add')
      expect(output).not.toContain('VaultManager.getActive')

      // Should show new SDK patterns
      expect(output).toContain('Vault initialized')
      const vaultData =
        expectedVaultData['TestSecureVault-cfa0-share2of2-NoPassword.vult']
      expect(output).toContain(vaultData.publicKeys.ecdsa)
    })

    test('should not use workaround patterns', () => {
      const vaultName = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const output = execSync(
        `${CLI_PATH} address --network bitcoin --vault "${vaultName}"`,
        {
          encoding: 'utf8',
          timeout: TIMEOUT,
        }
      )

      // Should NOT contain workaround patterns
      expect(output).not.toContain('Creating vault with WalletCore')
      expect(output).not.toContain('manual WalletCore initialization')
      expect(output).not.toContain('setWalletCore')

      // Should use proper SDK integration
      expect(output).toContain('Loading vault')
      expect(output).toContain('Successfully derived address')
    })
  })

  describe('WASM Loading', () => {
    test('should not fail with WASM fetch errors', () => {
      const vaultName = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const output = execSync(
        `${CLI_PATH} address --network bitcoin --vault "${vaultName}"`,
        {
          encoding: 'utf8',
          timeout: TIMEOUT,
        }
      )

      // Should NOT contain WASM loading errors
      expect(output).not.toContain('fetch failed')
      expect(output).not.toContain('Failed to initialize WASM modules')
      expect(output).not.toContain('Failed to initialize DKLS WASM')
      expect(output).not.toContain('Failed to initialize MPC lib')

      // Should show successful operation
      expect(output).toContain('Successfully derived address')
    })

    test('should have WalletCore properly initialized', () => {
      const vaultName = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const output = execSync(
        `${CLI_PATH} address --network bitcoin --vault "${vaultName}"`,
        {
          encoding: 'utf8',
          timeout: TIMEOUT,
        }
      )

      // Should show WalletCore is available
      const vaultData =
        expectedVaultData['TestSecureVault-cfa0-share2of2-NoPassword.vult']
      expect(output).toContain(vaultData.publicKeys.ecdsa)

      // Should NOT contain WalletCore errors
      expect(output).not.toContain('WalletCore instance is required')
      expect(output).not.toContain('WalletCore not initialized')
    })
  })

  describe('File Handling', () => {
    test('should not fail with File polyfill errors', () => {
      const vaultName = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const output = execSync(
        `${CLI_PATH} address --network bitcoin --vault "${vaultName}"`,
        {
          encoding: 'utf8',
          timeout: TIMEOUT,
        }
      )

      // Should NOT contain File polyfill errors
      expect(output).not.toContain('FileReader not available')
      expect(output).not.toContain('no internal buffer found')
      expect(output).not.toContain('Unable to read file')

      // Should show successful vault loading
      expect(output).toContain('Loading vault')
    })

    test('should handle vault files correctly', () => {
      const output = execSync(`${CLI_PATH} list`, { encoding: 'utf8' })

      // Should find and list vault files
      expect(output).toMatch(/Found \d+ vault file\(s\)/)
      expect(
        parseInt(output.match(/Found (\d+) vault file\(s\)/)[1])
      ).toBeGreaterThanOrEqual(3)
      expect(output).toContain('TestSecureVault')
      expect(output).toContain('🔓 unencrypted')
      expect(output).toContain('🔐 encrypted')
    })
  })

  describe('Import Resolution', () => {
    test('should not fail with module resolution errors', () => {
      const vaultName = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const output = execSync(
        `${CLI_PATH} address --network bitcoin --vault "${vaultName}"`,
        {
          encoding: 'utf8',
          timeout: TIMEOUT,
        }
      )

      // Should NOT contain module resolution errors
      expect(output).not.toContain('Cannot find module')
      expect(output).not.toContain(
        '@core/chain/publicKey/address/deriveAddress'
      )
      expect(output).not.toContain('MODULE_NOT_FOUND')

      // Should complete successfully
      expect(output).toContain('Successfully derived address')
    })

    test('should load SDK bundle correctly', () => {
      const vaultName = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const output = execSync(
        `${CLI_PATH} address --network bitcoin --vault "${vaultName}"`,
        {
          encoding: 'utf8',
          timeout: TIMEOUT,
        }
      )

      // Should show SDK is working
      expect(output).toContain('Vault initialized')
      expect(output).not.toContain('Failed to start Vultisig CLI')
    })
  })

  describe('Performance Regressions', () => {
    test('address derivation should not be slower than 10 seconds', () => {
      const startTime = Date.now()
      const vaultName = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )

      execSync(`${CLI_PATH} address --network bitcoin --vault "${vaultName}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      const duration = Date.now() - startTime
      expect(duration).toBeLessThan(10000)
    })

    test('list command should not be slower than 2 seconds', () => {
      const startTime = Date.now()

      execSync(`${CLI_PATH} list`, { encoding: 'utf8' })

      const duration = Date.now() - startTime
      expect(duration).toBeLessThan(2000)
    })

    test('help command should be instant', () => {
      const startTime = Date.now()

      execSync(`${CLI_PATH} --help`, { encoding: 'utf8' })

      const duration = Date.now() - startTime
      expect(duration).toBeLessThan(1000)
    })
  })

  describe('Output Format Consistency', () => {
    test('should maintain consistent address output format', () => {
      const vaultName = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const output = execSync(
        `${CLI_PATH} address --network bitcoin --vault "${vaultName}"`,
        {
          encoding: 'utf8',
          timeout: TIMEOUT,
        }
      )

      // Should follow expected format
      expect(output).toMatch(/=== Addresses \(ephemeral vault\) ===/)
      expect(output).toMatch(/✅ Bitcoin: bc1[a-z0-9]+/)
      expect(output).toMatch(
        /💡 Addresses retrieved from ephemeral vault operation/
      )
    })

    test('should show vault metadata consistently', () => {
      const vaultName = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const output = execSync(
        `${CLI_PATH} address --network bitcoin --vault "${vaultName}"`,
        {
          encoding: 'utf8',
          timeout: TIMEOUT,
        }
      )

      // Should show vault initialization info
      const vaultData =
        expectedVaultData['TestSecureVault-cfa0-share2of2-NoPassword.vult']

      expect(output).toMatch(/Vault initialized: \{/)
      expect(output).toContain(vaultData.publicKeys.ecdsa)
    })
  })
})
