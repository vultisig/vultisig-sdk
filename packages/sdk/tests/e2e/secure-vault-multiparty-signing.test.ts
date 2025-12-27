/**
 * E2E Test: SecureVault Multi-Party Signing
 *
 * Tests real ETH transfer from SecureVault to FastVault using
 * programmatic multi-party coordination (no QR codes).
 *
 * This test demonstrates how to:
 * 1. Load multiple vault shares from .vult files
 * 2. Prepare an ETH transaction using the SDK
 * 3. Coordinate MPC signing across all shares programmatically
 * 4. Broadcast the signed transaction to Ethereum mainnet
 *
 * Requirements:
 * - Multiple .vult files representing all shares of a SecureVault
 * - FastVault .vult file for destination address
 * - Environment variables for vault paths and passwords
 *
 * Environment Variables:
 * - SECURE_VAULT_SHARES: Comma-separated paths to SecureVault share files
 * - SECURE_VAULT_PASSWORD: Password for the SecureVault
 * - TEST_VAULT_PATH: Path to FastVault .vult file (destination)
 * - TEST_VAULT_PASSWORD: Password for the FastVault
 *
 * WARNING: This test broadcasts a REAL transaction to Ethereum mainnet!
 * Only run with test vaults containing small amounts.
 */

import { Chain } from '@core/chain/Chain'
import {
  coordinateMultiPartySigning,
  generateSharedSessionParams,
  getThreshold,
  loadVaultShare,
  RELAY_URL,
  VaultShareData,
  verifySharesMatch,
} from '@helpers/secure-vault-helpers'
import { loadTestVault } from '@helpers/test-vault'
import fs from 'fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'

import { getChainSigningInfo } from '../../src/adapters/getChainSigningInfo'
import { MemoryStorage } from '../../src/storage/MemoryStorage'
import { VaultBase } from '../../src/vault/VaultBase'
import { Vultisig } from '../../src/Vultisig'

/**
 * Test configuration from environment variables
 */
const SECURE_VAULT_CONFIG = {
  // Paths to all share files (comma-separated in env)
  sharePaths: (process.env.SECURE_VAULT_SHARES || '').split(',').filter(Boolean),
  password: process.env.SECURE_VAULT_PASSWORD || '',
}

/**
 * Amount to send: 0.0005 ETH in wei
 */
const ETH_AMOUNT = 500000000000000n // 0.0005 ETH

describe('E2E: SecureVault Multi-Party Signing', () => {
  let shares: VaultShareData[] = [] // Initialize as empty array
  let sourceVault: VaultBase
  let destinationAddress: string
  let sdk: Vultisig

  beforeAll(async () => {
    // Validate configuration
    if (SECURE_VAULT_CONFIG.sharePaths.length < 2) {
      console.log('='.repeat(60))
      console.log('SKIPPING: SecureVault multi-party test requires at least 2 share files.')
      console.log('Set SECURE_VAULT_SHARES env var to comma-separated paths.')
      console.log('Example:')
      console.log('  SECURE_VAULT_SHARES=/path/to/share1.vult,/path/to/share2.vult')
      console.log('  SECURE_VAULT_PASSWORD=your-password')
      console.log('='.repeat(60))
      shares = [] // Ensure empty array for skip checks
      return
    }

    console.log('='.repeat(60))
    console.log('SecureVault Multi-Party Signing Test')
    console.log('='.repeat(60))

    // Load all vault shares
    console.log('\n1. Loading SecureVault shares...')
    shares = await Promise.all(
      SECURE_VAULT_CONFIG.sharePaths.map(async path => {
        const share = await loadVaultShare(path, SECURE_VAULT_CONFIG.password)
        console.log(`   - Loaded share: ${share.localPartyId}`)
        return share
      })
    )
    console.log(`   Total shares loaded: ${shares.length}`)

    // Verify all shares belong to the same vault
    verifySharesMatch(shares)
    console.log(`   Vault verified: ${shares[0].name}`)
    console.log(`   Public key (ECDSA): ${shares[0].publicKeys.ecdsa.substring(0, 32)}...`)

    // Calculate threshold
    const threshold = getThreshold(shares.length)
    console.log(`   Threshold: ${threshold}-of-${shares.length}`)

    // Create SDK instance and import the first share as a vault
    // We use this vault for transaction preparation and broadcasting
    console.log('\n2. Creating SDK and importing source vault...')
    sdk = new Vultisig({
      storage: new MemoryStorage(),
      serverEndpoints: {
        fastVault: 'https://api.vultisig.com/vault',
        messageRelay: RELAY_URL,
      },
      defaultChains: [Chain.Ethereum],
      defaultCurrency: 'usd',
    })
    await sdk.initialize()

    // Read the first vault file and import it
    const firstVaultContent = await fs.readFile(SECURE_VAULT_CONFIG.sharePaths[0], 'utf-8')
    sourceVault = await sdk.importVault(firstVaultContent, SECURE_VAULT_CONFIG.password)
    const sourceAddress = await sourceVault.address(Chain.Ethereum)
    console.log(`   Source vault: ${sourceVault.name}`)
    console.log(`   Source address: ${sourceAddress}`)

    // Load FastVault to get destination address
    console.log('\n3. Loading FastVault for destination address...')
    try {
      const { vault: fastVault } = await loadTestVault()
      destinationAddress = await fastVault.address(Chain.Ethereum)
      console.log(`   Destination: ${destinationAddress}`)
    } catch {
      console.log('   FastVault not configured, using test address')
      destinationAddress = '0x742D35cC6634C0532925A3b844bc9E7595f0BEb8' // Standard test address
      console.log(`   Destination: ${destinationAddress}`)
    }

    console.log('\n' + '='.repeat(60))
  })

  describe('Transaction Preparation', () => {
    it('should skip if shares not configured', async () => {
      if (shares.length < 2) {
        console.log('Skipped: shares not configured')
        return
      }
      expect(shares.length).toBeGreaterThanOrEqual(2)
    })

    it('should prepare ETH send transaction', async () => {
      if (shares.length < 2) return

      const senderAddress = await sourceVault.address(Chain.Ethereum)

      const coin = {
        chain: Chain.Ethereum,
        address: senderAddress,
        decimals: 18,
        ticker: 'ETH',
      }

      const keysignPayload = await sourceVault.prepareSendTx({
        coin,
        receiver: destinationAddress,
        amount: ETH_AMOUNT,
      })

      expect(keysignPayload).toBeDefined()
      expect(keysignPayload.toAddress).toBe(destinationAddress)

      console.log(`\nTransaction prepared:`)
      console.log(`  Amount: ${ETH_AMOUNT} wei (0.0005 ETH)`)
      console.log(`  From: ${senderAddress}`)
      console.log(`  To: ${destinationAddress}`)
    })
  })

  describe('Multi-Party Signing Coordination', () => {
    it('should skip if shares not configured', async () => {
      if (shares.length < 2) {
        console.log('Skipped: shares not configured')
        return
      }
      expect(shares.length).toBeGreaterThanOrEqual(2)
    })

    it('should coordinate multi-party signing', async () => {
      if (shares.length < 2) return

      console.log('\n' + '='.repeat(60))
      console.log('Multi-Party Signing Coordination Test')
      console.log('='.repeat(60))

      // Step 1: Prepare transaction
      const senderAddress = await sourceVault.address(Chain.Ethereum)
      const coin = {
        chain: Chain.Ethereum,
        address: senderAddress,
        decimals: 18,
        ticker: 'ETH',
      }

      console.log('\n1. Preparing transaction...')
      const keysignPayload = await sourceVault.prepareSendTx({
        coin,
        receiver: destinationAddress,
        amount: ETH_AMOUNT,
      })

      // Step 2: Extract message hashes
      console.log('\n2. Extracting message hashes...')
      const messageHashes = await sourceVault.extractMessageHashes(keysignPayload)
      expect(messageHashes.length).toBeGreaterThan(0)
      console.log(`   Message hashes: ${messageHashes.length}`)
      messageHashes.forEach((hash, i) => {
        console.log(`   [${i}]: ${hash.substring(0, 32)}...`)
      })

      // Step 3: Generate shared session parameters
      console.log('\n3. Generating session parameters...')
      const { sessionId, hexEncryptionKey } = generateSharedSessionParams()
      console.log(`   Session ID: ${sessionId}`)

      // Step 4: Select threshold number of shares
      const threshold = getThreshold(shares.length)
      const participatingShares = shares.slice(0, threshold)
      console.log(`\n4. Using ${threshold} of ${shares.length} shares for signing`)
      participatingShares.forEach(share => {
        console.log(`   - ${share.localPartyId}`)
      })

      // Step 5: Get chain signing info
      const walletCore = await sourceVault['wasmProvider'].getWalletCore()
      const signingInfo = getChainSigningInfo({ chain: Chain.Ethereum }, walletCore)
      console.log(`\n5. Signing info:`)
      console.log(`   Algorithm: ${signingInfo.signatureAlgorithm}`)
      console.log(`   Derive path: ${signingInfo.derivePath}`)
      console.log(`   Chain path: ${signingInfo.chainPath}`)

      // Step 6: Coordinate multi-party signing
      console.log('\n6. Coordinating multi-party signing...')
      const signature = await coordinateMultiPartySigning(participatingShares, {
        sessionId,
        hexEncryptionKey,
        relayUrl: RELAY_URL,
        messageHashes,
        chainPath: signingInfo.chainPath,
        signatureAlgorithm: signingInfo.signatureAlgorithm,
      })

      // Step 7: Validate signature
      console.log('\n7. Validating signature...')
      expect(signature).toBeDefined()
      expect(signature.signature).toBeDefined()
      expect(signature.format).toBe('ECDSA')
      expect(signature.recovery).toBeDefined()
      console.log(`   Signature: ${signature.signature.substring(0, 40)}...`)
      console.log(`   Format: ${signature.format}`)
      console.log(`   Recovery: ${signature.recovery}`)

      console.log('\n' + '='.repeat(60))
      console.log('Multi-party signing coordination SUCCESSFUL!')
      console.log('='.repeat(60))
    }, 120000) // 2 minute timeout for signing coordination
  })

  describe('Transaction Broadcast', () => {
    it('should skip if shares not configured', async () => {
      if (shares.length < 2) {
        console.log('Skipped: shares not configured')
        return
      }
      expect(shares.length).toBeGreaterThanOrEqual(2)
    })

    it.skip('should broadcast signed transaction to Ethereum mainnet', async () => {
      // CAUTION: This test actually sends ETH!
      // Skipped by default - remove .skip to run
      if (shares.length < 2) return

      console.log('\n' + '='.repeat(60))
      console.log('BROADCASTING REAL TRANSACTION TO MAINNET')
      console.log('='.repeat(60))

      // Full signing and broadcast flow
      const senderAddress = await sourceVault.address(Chain.Ethereum)
      const coin = {
        chain: Chain.Ethereum,
        address: senderAddress,
        decimals: 18,
        ticker: 'ETH',
      }

      // Prepare
      const keysignPayload = await sourceVault.prepareSendTx({
        coin,
        receiver: destinationAddress,
        amount: ETH_AMOUNT,
      })

      // Extract hashes
      const messageHashes = await sourceVault.extractMessageHashes(keysignPayload)

      // Generate session
      const { sessionId, hexEncryptionKey } = generateSharedSessionParams()

      // Get signing info
      const walletCore = await sourceVault['wasmProvider'].getWalletCore()
      const signingInfo = getChainSigningInfo({ chain: Chain.Ethereum }, walletCore)

      // Sign
      const threshold = getThreshold(shares.length)
      const participatingShares = shares.slice(0, threshold)
      const signature = await coordinateMultiPartySigning(participatingShares, {
        sessionId,
        hexEncryptionKey,
        relayUrl: RELAY_URL,
        messageHashes,
        chainPath: signingInfo.chainPath,
        signatureAlgorithm: signingInfo.signatureAlgorithm,
      })

      // Broadcast
      console.log('\nBroadcasting transaction...')
      const txHash = await sourceVault.broadcastTx({
        chain: Chain.Ethereum,
        keysignPayload,
        signature,
      })

      expect(txHash).toBeDefined()
      expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/)

      console.log('\n' + '='.repeat(60))
      console.log('TRANSACTION BROADCAST SUCCESSFUL!')
      console.log(`TX Hash: ${txHash}`)
      console.log(`Explorer: https://etherscan.io/tx/${txHash}`)
      console.log('='.repeat(60))
    }, 180000) // 3 minute timeout for broadcast
  })
})
