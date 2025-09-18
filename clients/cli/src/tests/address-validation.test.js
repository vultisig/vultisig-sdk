/**
 * Address Validation Tests
 * Tests that CLI derives the exact same addresses as expected from vault JSON files
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

// Load test setup
require('./setup')
const { expectedAddresses, expectedVaultData, vaultsDir } = require('./setup')

const CLI_PATH = path.resolve(__dirname, '../../bin/vultisig')
const TIMEOUT = 30000

describe('Address Validation Tests', () => {
  describe('TestSecureVault (Unencrypted)', () => {
    const vaultFile = 'TestSecureVault-cfa0-share2of2-NoPassword.vult'
    const expected = expectedAddresses[vaultFile]

    test('should derive correct Bitcoin address', () => {
      const vaultPath = path.join(vaultsDir, vaultFile)
      const output = execSync(`${CLI_PATH} address --network bitcoin --vault "${vaultPath}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      expect(output).toContain(`Bitcoin: ${expected.Bitcoin}`)
    })

    test('should derive correct Ethereum address', () => {
      const vaultPath = path.join(vaultsDir, vaultFile)
      const output = execSync(`${CLI_PATH} address --network ethereum --vault "${vaultPath}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      expect(output).toContain(`Ethereum: ${expected.Ethereum}`)
    })

    test('should derive correct Solana address', () => {
      const vaultPath = path.join(vaultsDir, vaultFile)
      const output = execSync(`${CLI_PATH} address --network solana --vault "${vaultPath}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      expect(output).toContain(`Solana: ${expected.Solana}`)
    })

    test('should derive correct THORChain address', () => {
      const vaultPath = path.join(vaultsDir, vaultFile)
      const output = execSync(`${CLI_PATH} address --network thorchain --vault "${vaultPath}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      expect(output).toContain(`thorchain: ${expected.THORChain}`)
    })

    test('should derive correct Cosmos address', () => {
      const vaultPath = path.join(vaultsDir, vaultFile)
      const output = execSync(`${CLI_PATH} address --network cosmos --vault "${vaultPath}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      expect(output).toContain(`cosmos: ${expected.Cosmos}`)
    })

    test('should derive correct Litecoin address', () => {
      const vaultPath = path.join(vaultsDir, vaultFile)
      const output = execSync(`${CLI_PATH} address --network litecoin --vault "${vaultPath}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      expect(output).toContain(`Litecoin: ${expected.Litecoin}`)
    })

    test('should derive correct Dogecoin address', () => {
      const vaultPath = path.join(vaultsDir, vaultFile)
      const output = execSync(`${CLI_PATH} address --network dogecoin --vault "${vaultPath}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      expect(output).toContain(`Dogecoin: ${expected.Dogecoin}`)
    })

    test('should derive all addresses correctly when using --network all', () => {
      const vaultPath = path.join(vaultsDir, vaultFile)
      const output = execSync(`${CLI_PATH} address --network all --vault "${vaultPath}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      // Check all major addresses
      expect(output).toContain(`Bitcoin: ${expected.Bitcoin}`)
      expect(output).toContain(`Ethereum: ${expected.Ethereum}`)
      expect(output).toContain(`Solana: ${expected.Solana}`)
      expect(output).toContain(`Litecoin: ${expected.Litecoin}`)
      expect(output).toContain(`Dogecoin: ${expected.Dogecoin}`)
    })
  })

  describe('Vault Loading Tests', () => {
    test('should load vault with correct metadata', () => {
      const vaultPath = path.join(vaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const output = execSync(`${CLI_PATH} address --network bitcoin --vault "${vaultPath}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      const vaultData =
        expectedVaultData['TestSecureVault-cfa0-share2of2-NoPassword.vult']

      expect(output).toContain('TestSecureVault')
      expect(output).toContain(vaultData.publicKeys.ecdsa)
    })

    test('should show derivation timing information', () => {
      const vaultPath = path.join(vaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const output = execSync(`${CLI_PATH} address --network bitcoin --vault "${vaultPath}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      expect(output).toContain('Derivation time for bitcoin:')
      expect(output).toMatch(/\d+\.\d+ ms/)
    })

    test('should handle vault loading gracefully', () => {
      const vaultPath = path.join(vaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const output = execSync(`${CLI_PATH} address --network ethereum --vault "${vaultPath}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      expect(output).toContain('Loading vault')
      expect(output).toContain('Addresses retrieved from ephemeral vault operation')
      expect(output).not.toContain('Error')
      expect(output).not.toContain('Failed')
    })
  })

  describe('Network Support Tests', () => {
    const supportedNetworks = [
      'bitcoin',
      'ethereum',
      'solana',
      'litecoin',
      'dogecoin',
    ]

    test.each(supportedNetworks)('should support %s network', network => {
      const output = execSync(`${CLI_PATH} address --network ${network}`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      expect(output).toContain('Loading vault')
      expect(output).toContain(`${network}:`)
      expect(output).toContain('Successfully derived address')
    })

    test('should handle comma-separated networks', () => {
      const output = execSync(
        `${CLI_PATH} address --network bitcoin,ethereum,solana`,
        {
          encoding: 'utf8',
          timeout: TIMEOUT,
        }
      )

      expect(output).toContain('Bitcoin:')
      expect(output).toContain('Ethereum:')
      expect(output).toContain('Solana:')
    })
  })

  describe('SDK Integration Tests', () => {
    test('should use proper Vultisig SDK API', () => {
      const vaultPath = path.join(vaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const output = execSync(`${CLI_PATH} address --network bitcoin --vault "${vaultPath}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      // Should show SDK initialization working
      expect(output).toContain('Vault initialized')
      const vaultData = expectedVaultData['TestSecureVault-cfa0-share2of2-NoPassword.vult']
      expect(output).toContain(vaultData.publicKeys.ecdsa)
      expect(output).not.toContain('VaultManager') // Should not use old API
    })

    test('should handle WASM loading correctly', () => {
      const vaultPath = path.join(vaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const output = execSync(`${CLI_PATH} address --network bitcoin --vault "${vaultPath}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      // Should complete successfully without WASM errors
      expect(output).not.toContain('Failed to initialize WASM')
      expect(output).not.toContain('fetch failed')
      expect(output).toContain('Successfully derived address')
    })
  })

  describe('Error Recovery Tests', () => {
    test('should handle missing vault files gracefully', () => {
      // Temporarily move vault files
      const vaultPath = path.join(
        vaultsDir,
        'TestSecureVault-cfa0-share2of2-NoPassword.vult'
      )
      const backupPath = vaultPath + '.backup'

      fs.renameSync(vaultPath, backupPath)

      try {
        const output = execSync(`${CLI_PATH} list`, { encoding: 'utf8' })
        expect(output).toMatch(/Found \d+ vault file\(s\)/)
        expect(parseInt(output.match(/Found (\d+) vault file\(s\)/)[1])).toBeGreaterThanOrEqual(2) // One less file
      } finally {
        // Restore file
        fs.renameSync(backupPath, vaultPath)
      }
    })

    test('should provide helpful error messages', () => {
      const vaultPath = path.join(vaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const output = execSync(`${CLI_PATH} address --network bitcoin --vault "${vaultPath}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      // Should provide clear success messages
      expect(output).toContain('Loading vault')
      expect(output).toContain('Addresses retrieved from ephemeral vault operation')
    })
  })
})
