/**
 * Multi-Party Key Generation Helper Functions
 *
 * Utilities for simulating multiple MPC parties within a single test process
 * to create SecureVault shares programmatically without QR codes.
 *
 * This enables automated E2E testing of SecureVault creation via seedphrase import
 * where all key shares are generated and stored in memory.
 */

import { getKeygenThreshold } from '@core/mpc/getKeygenThreshold'
import { joinMpcSession } from '@core/mpc/session/joinMpcSession'
import { startMpcSession } from '@core/mpc/session/startMpcSession'
import { generateHexEncryptionKey } from '@core/mpc/utils/generateHexEncryptionKey'
import type { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { randomUUID } from 'crypto'

import type { SdkContext, VaultContext } from '../../../src/context/SdkContext'
import type { WasmProvider } from '../../../src/context/SdkContext'
import { MasterKeyDeriver } from '../../../src/seedphrase/MasterKeyDeriver'
import { createVaultBackup } from '../../../src/utils/export'
import { SecureVault } from '../../../src/vault/SecureVault'

// Dynamically import DKLS and Schnorr to avoid circular dependency issues
const getDKLS = async () => {
  const { DKLS } = await import('@core/mpc/dkls/dkls')
  return DKLS
}

const getSchnorr = async () => {
  const { Schnorr } = await import('@core/mpc/schnorr/schnorrKeygen')
  return Schnorr
}

/**
 * Relay server URL for MPC coordination
 */
export const RELAY_URL = 'https://api.vultisig.com/router'

/**
 * Result from a single key import operation
 */
export type KeyImportResult = {
  /** Base64-encoded keyshare */
  keyshare: string
  /** Hex-encoded public key */
  publicKey: string
  /** Hex-encoded chain code */
  chaincode: string
}

/**
 * Key import results for a single party
 */
export type PartyKeyImportResult = {
  /** Unique identifier for this party in MPC */
  localPartyId: string
  /** ECDSA key import result */
  ecdsa: KeyImportResult
  /** EdDSA key import result */
  eddsa: KeyImportResult
}

/**
 * Parameters for multi-party key import
 */
export type MultiPartyKeyImportParams = {
  /** BIP39 mnemonic phrase (12 or 24 words) */
  mnemonic: string
  /** Name for the vault */
  vaultName: string
  /** Number of parties (e.g., 3 for 2-of-3 threshold) */
  numParties: number
  /** WASM provider for WalletCore access */
  wasmProvider: WasmProvider
  /** SDK context for creating SecureVault instances (optional - if not provided, only CoreVault returned) */
  sdkContext?: SdkContext
  /** Optional session ID (auto-generated if not provided) */
  sessionId?: string
  /** Optional encryption key (auto-generated if not provided) */
  hexEncryptionKey?: string
}

/**
 * Result from multi-party key import
 */
export type MultiPartyKeyImportResult = {
  /** Key import results for each party */
  parties: PartyKeyImportResult[]
  /** Session ID used for coordination */
  sessionId: string
  /** Hex-encoded chain code */
  hexChainCode: string
  /** Threshold for signing (e.g., 2 for 2-of-3) */
  threshold: number
  /** CoreVault objects for each party (raw data) */
  vaults: CoreVault[]
  /** SecureVault instances for each party (with balance(), address(), etc.) - only if sdkContext provided */
  secureVaults?: SecureVault[]
}

/**
 * Generate a unique party ID for testing
 * Uses 'sdk' for first party and 'iphone'/'android' for subsequent to simulate real devices
 */
function generateTestPartyId(index: number): string {
  const devices = ['sdk', 'iphone', 'android', 'mac', 'windows']
  const device = devices[index % devices.length]
  const randomNum = Math.floor(Math.random() * 9000) + 1000
  return `${device}-${randomNum}`
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Coordinate multi-party key import from seedphrase
 *
 * Simulates N MPC parties importing the same seedphrase, each receiving
 * their own unique key share. Uses the relay server for coordination.
 *
 * @param params - Key import parameters
 * @returns Multi-party key import result with all vault shares
 *
 * @example
 * ```typescript
 * const result = await coordinateMultiPartyKeyImport({
 *   mnemonic: 'abandon abandon abandon ...',
 *   vaultName: 'Test Vault',
 *   numParties: 3,
 *   wasmProvider: sdk.wasmProvider,
 * })
 * console.log(`Created ${result.parties.length} shares with threshold ${result.threshold}`)
 * ```
 */
export async function coordinateMultiPartyKeyImport(
  params: MultiPartyKeyImportParams
): Promise<MultiPartyKeyImportResult> {
  const {
    mnemonic,
    vaultName,
    numParties,
    wasmProvider,
    sessionId = randomUUID(),
    hexEncryptionKey = generateHexEncryptionKey(),
  } = params

  const threshold = getKeygenThreshold(numParties)

  // Generate unique party IDs
  const partyIds = Array.from({ length: numParties }, (_, i) => generateTestPartyId(i))

  console.log(`\n🔐 Starting multi-party key import`)
  console.log(`   Parties: ${partyIds.join(', ')}`)
  console.log(`   Session ID: ${sessionId}`)
  console.log(`   Threshold: ${threshold}-of-${numParties}`)

  // Derive master keys from mnemonic
  console.log(`\n📝 Deriving master keys from mnemonic...`)
  const keyDeriver = new MasterKeyDeriver(wasmProvider)
  const masterKeys = await keyDeriver.deriveMasterKeys(mnemonic)
  console.log(`   ECDSA master key: ${masterKeys.ecdsaPrivateKeyHex.substring(0, 16)}...`)
  console.log(`   EdDSA master key: ${masterKeys.eddsaPrivateKeyHex.substring(0, 16)}...`)

  // Step 1: All parties join the relay session
  console.log(`\n📡 All parties joining relay session...`)
  await Promise.all(
    partyIds.map(partyId =>
      joinMpcSession({
        serverUrl: RELAY_URL,
        sessionId,
        localPartyId: partyId,
      })
    )
  )
  await sleep(500)
  console.log(`   All ${numParties} parties joined`)

  // Step 2: First party starts the session
  console.log(`\n🚀 Starting MPC session...`)
  await startMpcSession({
    serverUrl: RELAY_URL,
    sessionId,
    devices: partyIds,
  })
  await sleep(500)
  console.log(`   Session started`)

  // Step 3: Run ECDSA key import (DKLS) for all parties in parallel
  console.log(`\n🔑 Running ECDSA key import (DKLS)...`)
  const DKLS = await getDKLS()
  const ecdsaPromises = partyIds.map((localPartyId, index) => {
    const isInitiateDevice = index === 0
    const dkls = new DKLS(
      { keyimport: true },
      isInitiateDevice,
      RELAY_URL,
      sessionId,
      localPartyId,
      partyIds,
      [], // oldKeygenCommittee - not used for key import
      hexEncryptionKey
    )
    return dkls.startKeyImportWithRetry(
      masterKeys.ecdsaPrivateKeyHex,
      masterKeys.chainCodeHex || generateHexEncryptionKey() // Use derived chain code or generate one
    )
  })
  const ecdsaResults = await Promise.all(ecdsaPromises)
  console.log(`   ECDSA public key: ${ecdsaResults[0].publicKey.substring(0, 32)}...`)
  console.log(`   Chain code: ${ecdsaResults[0].chaincode.substring(0, 32)}...`)

  // Use the chain code from ECDSA result for EdDSA
  const hexChainCode = ecdsaResults[0].chaincode

  // Step 4: Generate new session for EdDSA (need separate session to avoid message collision)
  const eddsaSessionId = `${sessionId}-eddsa`
  console.log(`\n📡 Joining EdDSA session...`)
  await Promise.all(
    partyIds.map(partyId =>
      joinMpcSession({
        serverUrl: RELAY_URL,
        sessionId: eddsaSessionId,
        localPartyId: partyId,
      })
    )
  )
  await sleep(500)
  await startMpcSession({
    serverUrl: RELAY_URL,
    sessionId: eddsaSessionId,
    devices: partyIds,
  })
  await sleep(500)

  // Step 5: Run EdDSA key import (Schnorr) for all parties in parallel
  console.log(`\n🔑 Running EdDSA key import (Schnorr)...`)
  const Schnorr = await getSchnorr()
  const eddsaPromises = partyIds.map((localPartyId, index) => {
    const isInitiateDevice = index === 0
    const schnorr = new Schnorr(
      { keyimport: true },
      isInitiateDevice,
      RELAY_URL,
      eddsaSessionId,
      localPartyId,
      partyIds,
      [], // oldKeygenCommittee
      hexEncryptionKey,
      new Uint8Array() // setupMessage - will be created/fetched by the class
    )
    return schnorr.startKeyImportWithRetry(
      masterKeys.eddsaPrivateKeyHex,
      hexChainCode,
      'eddsa_key_import' // additionalHeader to differentiate from ECDSA
    )
  })
  const eddsaResults = await Promise.all(eddsaPromises)
  console.log(`   EdDSA public key: ${eddsaResults[0].publicKey.substring(0, 32)}...`)

  // Step 6: Build CoreVault objects for each party
  console.log(`\n📦 Building vault structures...`)
  const vaults: CoreVault[] = partyIds.map((localPartyId, index) => ({
    name: vaultName,
    publicKeys: {
      ecdsa: ecdsaResults[0].publicKey, // Same for all parties
      eddsa: eddsaResults[0].publicKey, // Same for all parties
    },
    localPartyId,
    signers: partyIds,
    hexChainCode,
    keyShares: {
      ecdsa: ecdsaResults[index].keyshare, // Unique per party
      eddsa: eddsaResults[index].keyshare, // Unique per party
    },
    libType: 'DKLS',
    isBackedUp: false,
    order: 0,
    createdAt: Date.now(),
  }))

  const parties: PartyKeyImportResult[] = partyIds.map((localPartyId, index) => ({
    localPartyId,
    ecdsa: ecdsaResults[index],
    eddsa: eddsaResults[index],
  }))

  console.log(`\n✅ Multi-party key import complete!`)
  console.log(`   Created ${numParties} vault shares`)
  console.log(`   Threshold: ${threshold}-of-${numParties}`)

  // Step 7: Create SecureVault instances if sdkContext provided
  let secureVaults: SecureVault[] | undefined
  if (params.sdkContext) {
    console.log(`\n🔒 Creating SecureVault instances...`)
    const vaultContext: VaultContext = {
      storage: params.sdkContext.storage,
      config: params.sdkContext.config,
      serverManager: params.sdkContext.serverManager,
      passwordCache: params.sdkContext.passwordCache,
      wasmProvider: params.sdkContext.wasmProvider,
    }

    secureVaults = await Promise.all(
      vaults.map(async coreVault => {
        // Export to .vult format (required for SecureVault)
        const vultContent = await createVaultBackup(coreVault)
        const vaultId = coreVault.publicKeys.ecdsa
        // Create SecureVault with pre-loaded keyshares
        return SecureVault.fromImport(vaultId, vultContent, coreVault, vaultContext)
      })
    )
    console.log(`   Created ${secureVaults.length} SecureVault instances with balance() support`)
  }

  return {
    parties,
    sessionId,
    hexChainCode,
    threshold,
    vaults,
    secureVaults,
  }
}

/**
 * Verify that all vault shares have identical public keys
 *
 * @param vaults - Array of CoreVault objects to verify
 * @throws Error if public keys don't match
 */
export function verifyVaultsMatch(vaults: CoreVault[]): void {
  if (vaults.length < 2) {
    throw new Error('Need at least 2 vaults to verify')
  }

  const expectedEcdsa = vaults[0].publicKeys.ecdsa
  const expectedEddsa = vaults[0].publicKeys.eddsa
  const expectedChainCode = vaults[0].hexChainCode

  for (const vault of vaults) {
    if (vault.publicKeys.ecdsa !== expectedEcdsa) {
      throw new Error(`Vault ${vault.localPartyId} has different ECDSA public key`)
    }
    if (vault.publicKeys.eddsa !== expectedEddsa) {
      throw new Error(`Vault ${vault.localPartyId} has different EdDSA public key`)
    }
    if (vault.hexChainCode !== expectedChainCode) {
      throw new Error(`Vault ${vault.localPartyId} has different chain code`)
    }
  }
}

/**
 * Verify that all vault shares have unique keyshares
 *
 * @param vaults - Array of CoreVault objects to verify
 * @throws Error if keyshares are not unique
 */
export function verifyUniqueKeyshares(vaults: CoreVault[]): void {
  const ecdsaKeyshares = new Set(vaults.map(v => v.keyShares.ecdsa))
  const eddsaKeyshares = new Set(vaults.map(v => v.keyShares.eddsa))

  if (ecdsaKeyshares.size !== vaults.length) {
    throw new Error('ECDSA keyshares are not unique across vaults')
  }
  if (eddsaKeyshares.size !== vaults.length) {
    throw new Error('EdDSA keyshares are not unique across vaults')
  }
}
