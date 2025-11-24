/**
 * CLI Commands Tests
 * Tests all CLI commands to prevent regressions
 */

const { execSync, spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

// Load test setup
require('./setup')
const { expectedAddresses, expectedVaultData, vaultsDir } = require('./setup')

const CLI_PATH = path.resolve(__dirname, '../../bin/vultisig')
const TIMEOUT = 30000 // 30 seconds

describe('CLI Commands Tests', () => {
  beforeAll(() => {
    // Ensure CLI is built
    expect(fs.existsSync(CLI_PATH)).toBe(true)

    // Ensure test vaults exist
    expect(fs.existsSync(path.join(vaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult'))).toBe(true)
    expect(fs.existsSync(path.join(vaultsDir, 'TestFastVault-44fd-share2of2-Password123!.vult'))).toBe(true)
  })

  describe('Version Command', () => {
    test('should show version number', () => {
      const output = execSync(`${CLI_PATH} version`, { encoding: 'utf8' })
      expect(output.trim()).toBe('1.0.0')
    })

    test('should show version with --version flag', () => {
      const output = execSync(`${CLI_PATH} --version`, { encoding: 'utf8' })
      expect(output.trim()).toBe('1.0.0')
    })
  })

  describe('Help Command', () => {
    test('should show help with --help flag', () => {
      const output = execSync(`${CLI_PATH} --help`, { encoding: 'utf8' })
      expect(output).toContain('Vultisig CLI - Multi-Party Computation wallet')
      expect(output).toContain('Commands:')
      expect(output).toContain('init')
      expect(output).toContain('list')
      expect(output).toContain('address')
      expect(output).toContain('run')
    })

    test('should show command-specific help', () => {
      const output = execSync(`${CLI_PATH} address --help`, {
        encoding: 'utf8',
      })
      expect(output).toContain('Show wallet addresses')
      expect(output).toContain('--network')
    })
  })

  describe('Init Command', () => {
    test('should initialize directories', () => {
      const output = execSync(`${CLI_PATH} init`, { encoding: 'utf8' })
      expect(output).toContain('Initializing Vultisig CLI')
      expect(output).toContain('Initialization complete')
      expect(output).toContain('vaults')
    })
  })

  describe('List Command', () => {
    test('should list available vault files', () => {
      const output = execSync(`${CLI_PATH} list`, { encoding: 'utf8' })
      expect(output).toMatch(/Found \d+ vault file\(s\)/)
      expect(parseInt(output.match(/Found (\d+) vault file\(s\)/)[1])).toBeGreaterThanOrEqual(3)
      expect(output).toContain('TestFastVault-44fd-share2of2-Password123!.vult')
      expect(output).toContain('TestSecureVault')
      expect(output).toContain('🔐 encrypted')
      expect(output).toContain('🔓 unencrypted')
    })
  })

  describe('Address Command', () => {
    test('should derive Bitcoin address for unencrypted vault', () => {
      const vaultFile = path.join(vaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const output = execSync(`${CLI_PATH} address --network bitcoin --vault "${vaultFile}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      const expectedBitcoinAddress = expectedAddresses['TestSecureVault-cfa0-share2of2-NoPassword.vult'].Bitcoin

      expect(output).toContain('Loading vault')
      expect(output).toContain('TestSecureVault') // Vault name, not filename
      const vaultData = expectedVaultData['TestSecureVault-cfa0-share2of2-NoPassword.vult']
      expect(output).toContain(vaultData.publicKeys.ecdsa)
      expect(output).toContain(`Bitcoin: ${expectedBitcoinAddress}`)
      expect(output).toContain('Addresses retrieved from ephemeral vault operation')
    })

    test('should derive Ethereum address for unencrypted vault', () => {
      const vaultFile = path.join(vaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const output = execSync(`${CLI_PATH} address --network ethereum --vault "${vaultFile}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      const expectedEthereumAddress = expectedAddresses['TestSecureVault-cfa0-share2of2-NoPassword.vult'].Ethereum

      expect(output).toContain('Loading vault')
      expect(output).toContain(`Ethereum: ${expectedEthereumAddress}`)
    })

    test('should derive Solana address for unencrypted vault', () => {
      const vaultFile = path.join(vaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const output = execSync(`${CLI_PATH} address --network solana --vault "${vaultFile}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      const expectedSolanaAddress = expectedAddresses['TestSecureVault-cfa0-share2of2-NoPassword.vult'].Solana

      expect(output).toContain('Loading vault')
      expect(output).toContain(`Solana: ${expectedSolanaAddress}`)
    })

    test('should derive addresses for all supported chains', () => {
      const vaultFile = path.join(vaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const output = execSync(`${CLI_PATH} address --network all --vault "${vaultFile}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      // Check that all major chains are derived
      const vaultAddresses = expectedAddresses['TestSecureVault-cfa0-share2of2-NoPassword.vult']

      expect(output).toContain(`Bitcoin: ${vaultAddresses.Bitcoin}`)
      expect(output).toContain(`Ethereum: ${vaultAddresses.Ethereum}`)
      expect(output).toContain(`Solana: ${vaultAddresses.Solana}`)
      expect(output).toContain(`Litecoin: ${vaultAddresses.Litecoin}`)
      expect(output).toContain(`Dogecoin: ${vaultAddresses.Dogecoin}`)
    })

    test('should handle custom network list', () => {
      const output = execSync(`${CLI_PATH} address --network btc,eth`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      expect(output).toContain('btc:')
      expect(output).toContain('eth:')
      // Should not contain other chains
      expect(output).not.toContain('solana:')
    })

    test('should show performance metrics', () => {
      const vaultName = path.join(vaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')
      const output = execSync(`${CLI_PATH} address --network bitcoin --vault "${vaultName}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      expect(output).toContain('Derivation time for bitcoin:')
      expect(output).toMatch(/\d+\.\d+ ms/) // Should show timing in ms
    })
  })

  describe('Status Command', () => {
    test('should show daemon status when no daemon running', () => {
      try {
        const output = execSync(`${CLI_PATH} status`, {
          encoding: 'utf8',
          stdio: 'pipe',
        })
        expect(output).toContain('Checking daemon status')
      } catch (error) {
        // Status command exits with error code when daemon not running - this is expected
        expect(error.stdout || error.stderr).toContain('Daemon is not running')
      }
    })
  })

  describe('Error Handling', () => {
    test('should handle invalid commands gracefully', () => {
      try {
        execSync(`${CLI_PATH} invalid-command`, {
          encoding: 'utf8',
          stdio: 'pipe',
        })
        fail('Should have thrown an error')
      } catch (error) {
        expect(error.stdout || error.stderr).toContain('unknown command')
      }
    })

    test('should handle invalid network names', () => {
      const output = execSync(`${CLI_PATH} address --network invalid-network`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      expect(output).toContain('Loading vault')
      // Should handle gracefully, not crash
    })
  })

  describe('Performance Tests', () => {
    test('address derivation should complete within reasonable time', () => {
      const startTime = Date.now()
      const vaultName = path.join(vaultsDir, 'TestSecureVault-cfa0-share2of2-NoPassword.vult')

      execSync(`${CLI_PATH} address --network bitcoin --vault "${vaultName}"`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
      })

      const duration = Date.now() - startTime
      expect(duration).toBeLessThan(10000) // Should complete within 10 seconds
    })

    test('list command should be fast', () => {
      const startTime = Date.now()

      execSync(`${CLI_PATH} list`, { encoding: 'utf8' })

      const duration = Date.now() - startTime
      expect(duration).toBeLessThan(2000) // Should complete within 2 seconds
    })
  })
})

// Helper functions for tests
function expectValidAddress(address, network) {
  expect(address).toBeTruthy()
  expect(typeof address).toBe('string')

  switch (network.toLowerCase()) {
    case 'bitcoin':
    case 'litecoin':
      expect(address).toMatch(/^(bc1|ltc1|[13])/) // Bitcoin/Litecoin formats
      break
    case 'ethereum':
    case 'bsc':
    case 'polygon':
    case 'avalanche':
    case 'arbitrum':
    case 'optimism':
    case 'base':
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/) // Ethereum format
      break
    case 'solana':
      expect(address).toMatch(/^[A-Za-z0-9]{32,44}$/) // Solana format
      break
    case 'dogecoin':
      expect(address).toMatch(/^D[A-Za-z0-9]/) // Dogecoin format
      break
    default:
      // Generic check - should be non-empty string
      expect(address.length).toBeGreaterThan(0)
  }
}

module.exports = {
  CLI_PATH,
  TIMEOUT,
  expectedAddresses,
  vaultsDir,
  expectValidAddress,
}
