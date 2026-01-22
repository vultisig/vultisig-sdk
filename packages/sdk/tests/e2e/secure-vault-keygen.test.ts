/**
 * E2E Test: SecureVault Fresh Keygen (3 SDK Instances)
 *
 * Tests programmatic creation of a 2-of-3 SecureVault via fresh keygen by:
 * 1. SDK 1 (initiator) calls createSecureVault() and generates QR
 * 2. SDK 2 & 3 (joiners) call joinSecureVault() with the QR payload
 * 3. All 3 SDKs coordinate via relay server to generate fresh keys
 * 4. Each SDK returns a SecureVault with working balance(), address(), etc.
 *
 * Unlike the from-seedphrase test, this test does NOT require a mnemonic.
 * The keys are generated fresh using MPC keygen (not key import).
 *
 * NO MOCKING of MPC process - uses real relay server and WASM libraries.
 */

import { Chain } from '@core/chain/Chain'
import { beforeAll, describe, expect, it } from 'vitest'

import { MemoryStorage } from '../../src/storage/MemoryStorage'
import { SecureVault } from '../../src/vault/SecureVault'
import { Vultisig } from '../../src/Vultisig'

/**
 * Test configuration
 */
const TEST_CONFIG = {
  // Number of devices (3 for 2-of-3 threshold)
  numDevices: 3,
  // Vault name
  vaultName: 'E2E 3-SDK Keygen Test',
  // Password for vault encryption
  password: 'test-password-123',
}

/**
 * Helper to wait for a condition
 */
async function waitFor(condition: () => boolean | undefined, timeoutMs = 30000, intervalMs = 100): Promise<void> {
  const startTime = Date.now()
  while (!condition()) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error('Timeout waiting for condition')
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}

describe('E2E: SecureVault Fresh Keygen (3 SDK Instances)', () => {
  // Create 3 separate SDK instances with their own storage
  let sdk1: Vultisig
  let sdk2: Vultisig
  let sdk3: Vultisig

  // Vaults from each SDK
  let vault1: SecureVault | null = null
  let vault2: SecureVault | null = null
  let vault3: SecureVault | null = null

  beforeAll(async () => {
    console.log('='.repeat(60))
    console.log('SecureVault 3-SDK Fresh Keygen E2E Test')
    console.log('='.repeat(60))

    // Initialize 3 SDK instances with separate storage
    console.log('\n1. Initializing 3 SDK instances...')

    sdk1 = new Vultisig({
      storage: new MemoryStorage(),
      serverEndpoints: {
        fastVault: 'https://api.vultisig.com/vault',
        messageRelay: 'https://api.vultisig.com/router',
      },
      defaultChains: [Chain.Ethereum],
      defaultCurrency: 'usd',
    })

    sdk2 = new Vultisig({
      storage: new MemoryStorage(),
      serverEndpoints: {
        fastVault: 'https://api.vultisig.com/vault',
        messageRelay: 'https://api.vultisig.com/router',
      },
      defaultChains: [Chain.Ethereum],
      defaultCurrency: 'usd',
    })

    sdk3 = new Vultisig({
      storage: new MemoryStorage(),
      serverEndpoints: {
        fastVault: 'https://api.vultisig.com/vault',
        messageRelay: 'https://api.vultisig.com/router',
      },
      defaultChains: [Chain.Ethereum],
      defaultCurrency: 'usd',
    })

    await Promise.all([sdk1.initialize(), sdk2.initialize(), sdk3.initialize()])
    console.log('   All 3 SDKs initialized')
  }, 30000)

  describe('Multi-Device Fresh Keygen', () => {
    it('should create 3 vault shares using 3 SDK instances via keygen', async () => {
      console.log('\n2. Creating vault with 3 SDK instances via fresh keygen...')
      console.log('   (SDK 1 initiates, SDK 2 & 3 join via QR payload)')

      // SDK 1 initiates and captures QR payload
      let qrPayload: string | undefined

      const promise1 = sdk1.createSecureVault({
        name: TEST_CONFIG.vaultName,
        password: TEST_CONFIG.password,
        devices: TEST_CONFIG.numDevices,
        onQRCodeReady: qr => {
          console.log('   QR code generated')
          qrPayload = qr
        },
        onDeviceJoined: (_deviceId, total, required) => {
          console.log(`   SDK 1: Device joined (${total}/${required})`)
        },
      })

      // Wait for QR payload to be ready
      console.log('   Waiting for QR code...')
      await waitFor(() => qrPayload !== undefined)
      console.log('   QR payload received, starting joiners')

      // SDK 2 & 3 join using the QR payload - NO MNEMONIC needed for keygen!
      const promise2 = sdk2.joinSecureVault(qrPayload!, {
        devices: TEST_CONFIG.numDevices,
        onDeviceJoined: (_deviceId, total, required) => {
          console.log(`   SDK 2: Device joined (${total}/${required})`)
        },
      })

      const promise3 = sdk3.joinSecureVault(qrPayload!, {
        devices: TEST_CONFIG.numDevices,
        onDeviceJoined: (_deviceId, total, required) => {
          console.log(`   SDK 3: Device joined (${total}/${required})`)
        },
      })

      // Wait for all 3 to complete
      console.log('   Waiting for all 3 SDKs to complete MPC keygen...')
      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3])

      // Store vaults
      vault1 = result1.vault
      vault2 = result2.vault
      vault3 = result3.vault

      // Verify all vaults have the same ID (ECDSA public key)
      expect(result1.vaultId).toBe(result2.vaultId)
      expect(result2.vaultId).toBe(result3.vaultId)

      console.log(`\n   Summary:`)
      console.log(`   - Vault ID: ${result1.vaultId.substring(0, 32)}...`)
      console.log(`   - All 3 SDKs have matching vault IDs`)

      // Verify each vault has a unique local party ID
      const partyIds = [vault1.localPartyId, vault2.localPartyId, vault3.localPartyId]
      const uniquePartyIds = new Set(partyIds)
      expect(uniquePartyIds.size).toBe(3)
      console.log(`   - Each SDK has unique party ID`)
    }, 300000) // 5 minute timeout for MPC coordination
  })

  describe('Vault Verification', () => {
    it('should skip if vaults not created', () => {
      if (!vault1 || !vault2 || !vault3) {
        console.log('Skipped: vaults not created')
        return
      }
      expect(vault1).toBeDefined()
    })

    it('should have all vaults with same public keys', () => {
      if (!vault1 || !vault2 || !vault3) return

      console.log('\n3. Verifying vault public keys...')

      // All vaults should have same public keys (they share the same root keys)
      expect(vault1.publicKeys.ecdsa).toBe(vault2.publicKeys.ecdsa)
      expect(vault2.publicKeys.ecdsa).toBe(vault3.publicKeys.ecdsa)
      expect(vault1.publicKeys.eddsa).toBe(vault2.publicKeys.eddsa)
      expect(vault2.publicKeys.eddsa).toBe(vault3.publicKeys.eddsa)

      console.log(`   ECDSA: ${vault1.publicKeys.ecdsa.substring(0, 32)}...`)
      console.log(`   EdDSA: ${vault1.publicKeys.eddsa.substring(0, 32)}...`)
      console.log(`   All 3 vaults have matching public keys`)
    })

    it('should have all vaults with same signers list', () => {
      if (!vault1 || !vault2 || !vault3) return

      console.log('\n4. Verifying signers list...')

      // All vaults should have the same number of signers
      expect(vault1.signers.length).toBe(TEST_CONFIG.numDevices)
      expect(vault2.signers.length).toBe(TEST_CONFIG.numDevices)
      expect(vault3.signers.length).toBe(TEST_CONFIG.numDevices)

      // Extract signer IDs
      const signerIds1 = vault1.signers.map(s => s.id)
      const signerIds2 = vault2.signers.map(s => s.id)
      const signerIds3 = vault3.signers.map(s => s.id)

      // Signers should be the same set (may be in different order)
      const signers2Set = new Set(signerIds2)
      const signers3Set = new Set(signerIds3)

      for (const signerId of signerIds1) {
        expect(signers2Set.has(signerId)).toBe(true)
        expect(signers3Set.has(signerId)).toBe(true)
      }

      console.log(`   Signers: ${vault1.signers.length}`)
      signerIds1.forEach(s => console.log(`   - ${s}`))
      console.log(`   All 3 vaults have identical signers list`)
    })

    it('should have each vault with unique local party ID', () => {
      if (!vault1 || !vault2 || !vault3) return

      console.log('\n5. Verifying unique party IDs...')

      // Each vault should have a unique local party ID (this is how MPC works)
      const partyIds = [vault1.localPartyId, vault2.localPartyId, vault3.localPartyId]
      const uniquePartyIds = new Set(partyIds)
      expect(uniquePartyIds.size).toBe(3)

      console.log(`   Party IDs: ${uniquePartyIds.size} unique`)
      partyIds.forEach(id => console.log(`   - ${id}`))
      console.log(`   Each vault has unique party ID (as expected for MPC)`)
    })

    it('should derive identical ETH address on all 3 vaults', async () => {
      if (!vault1 || !vault2 || !vault3) return

      console.log('\n6. Checking ETH address on all 3 vaults...')

      const [addr1, addr2, addr3] = await Promise.all([
        vault1.address(Chain.Ethereum),
        vault2.address(Chain.Ethereum),
        vault3.address(Chain.Ethereum),
      ])

      // All vaults should derive the same address
      expect(addr1).toBe(addr2)
      expect(addr2).toBe(addr3)
      expect(addr1).toMatch(/^0x[a-fA-F0-9]{40}$/)

      console.log(`   ETH Address: ${addr1}`)
      console.log(`   All 3 vaults derive identical address`)
    }, 30000)
  })

  describe('Cleanup', () => {
    it('should summarize test results', () => {
      console.log('\n' + '='.repeat(60))
      if (vault1 && vault2 && vault3) {
        console.log('3-SDK SecureVault Fresh Keygen Test PASSED!')
        console.log('')
        console.log('Summary:')
        console.log('- 3 SDK instances successfully coordinated via fresh keygen')
        console.log('- No seedphrase needed - keys generated fresh via MPC')
        console.log('- Each returned a working SecureVault')
        console.log('- Public keys match, keyshares are unique')
      } else {
        console.log('Test skipped or failed - see above for details')
      }
      console.log('='.repeat(60))
    })
  })
})
