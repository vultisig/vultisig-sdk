/**
 * SecureVault Multi-Party Signing Helper Functions
 *
 * Utilities for loading SecureVault shares and coordinating multi-party MPC signing
 * without requiring QR code scanning. This enables automated testing of SecureVault
 * transactions when all key shares are available.
 *
 * SECURITY NOTE: These helpers require access to ALL vault key shares.
 * In production, shares are distributed across devices for security.
 */

import { fromBinary } from '@bufbuild/protobuf'
import { SignatureAlgorithm } from '@core/chain/signing/SignatureAlgorithm'
import { keysign } from '@core/mpc/keysign'
import { KeysignSignature } from '@core/mpc/keysign/KeysignSignature'
import { joinMpcSession } from '@core/mpc/session/joinMpcSession'
import { startMpcSession } from '@core/mpc/session/startMpcSession'
import { fromCommVault } from '@core/mpc/types/utils/commVault'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { generateHexEncryptionKey } from '@core/mpc/utils/generateHexEncryptionKey'
import { vaultContainerFromString } from '@core/mpc/vault/utils/vaultContainerFromString'
import { decryptWithAesGcm } from '@lib/utils/encryption/aesGcm/decryptWithAesGcm'
import { fromBase64 } from '@lib/utils/fromBase64'
import { randomUUID } from 'crypto'
import fs from 'fs/promises'

import type { Signature } from '@/types'

/**
 * Vault share data extracted from a .vult file
 */
export type VaultShareData = {
  /** Unique identifier for this party in MPC */
  localPartyId: string
  /** Key shares for ECDSA and EdDSA signing */
  keyShares: { ecdsa: string; eddsa: string }
  /** Public keys (same across all shares of a vault) */
  publicKeys: { ecdsa: string; eddsa: string }
  /** List of all signers in this vault */
  signers: string[]
  /** Hex-encoded chain code for HD derivation */
  hexChainCode: string
  /** Vault name */
  name: string
}

/**
 * Parameters for multi-party signing coordination
 */
export type MultiPartySigningParams = {
  /** Unique session ID for this signing operation */
  sessionId: string
  /** Hex-encoded encryption key for MPC messages */
  hexEncryptionKey: string
  /** Relay server URL for coordination */
  relayUrl: string
  /** Message hashes to sign (hex-encoded) */
  messageHashes: string[]
  /** Derivation path for HD key */
  chainPath: string
  /** Signature algorithm to use */
  signatureAlgorithm: SignatureAlgorithm
}

/**
 * Relay server URL for MPC coordination
 */
export const RELAY_URL = 'https://api.vultisig.com/router'

/**
 * Load and decrypt a vault share from a .vult file
 *
 * @param vaultPath - Path to the .vult file
 * @param password - Password for encrypted vaults
 * @returns Extracted vault share data
 *
 * @example
 * ```typescript
 * const share = await loadVaultShare('/path/to/share1.vult', 'password')
 * console.log(`Loaded share for party: ${share.localPartyId}`)
 * ```
 */
export async function loadVaultShare(vaultPath: string, password: string): Promise<VaultShareData> {
  // Read vault file
  const vaultContent = await fs.readFile(vaultPath, 'utf-8')

  // Parse vault container
  const container = vaultContainerFromString(vaultContent.trim())

  // Decrypt if encrypted
  let vaultBase64: string
  if (container.isEncrypted) {
    if (!password) {
      throw new Error('Password required for encrypted vault')
    }
    const encryptedData = fromBase64(container.vault)
    const decryptedBuffer = await decryptWithAesGcm({
      key: password,
      value: encryptedData,
    })
    vaultBase64 = Buffer.from(decryptedBuffer).toString('base64')
  } else {
    vaultBase64 = container.vault
  }

  // Parse vault protobuf
  const vaultBinary = fromBase64(vaultBase64)
  const vaultProtobuf = fromBinary(VaultSchema, vaultBinary)
  const parsedVault = fromCommVault(vaultProtobuf)

  // Validate keyshares are present and are strings
  // The issue is that fromCommVault looks for keyshares by matching public key
  // If vault doesn't have keyshares at all, we need to check the raw protobuf
  if (!parsedVault.keyShares?.ecdsa || parsedVault.keyShares.ecdsa.length === 0) {
    // Debug info in error message
    const keySharesInfo = vaultProtobuf.keyShares.map(ks => ({
      publicKey: ks.publicKey?.substring(0, 30) + '...',
      keyshareLength: ks.keyshare?.length || 0,
    }))
    throw new Error(
      `Invalid ECDSA keyShare (length=0). ` +
        `Protobuf has ${vaultProtobuf.keyShares.length} keyShares: ${JSON.stringify(keySharesInfo)}. ` +
        `publicKeyEcdsa: ${vaultProtobuf.publicKeyEcdsa?.substring(0, 30)}...`
    )
  }
  if (!parsedVault.keyShares?.eddsa || parsedVault.keyShares.eddsa.length === 0) {
    throw new Error(`Invalid EdDSA keyShare: length=${parsedVault.keyShares?.eddsa?.length}`)
  }

  return {
    localPartyId: parsedVault.localPartyId,
    keyShares: parsedVault.keyShares,
    publicKeys: parsedVault.publicKeys,
    signers: parsedVault.signers,
    hexChainCode: parsedVault.hexChainCode,
    name: parsedVault.name,
  }
}

/**
 * Generate shared session parameters for multi-party signing
 *
 * Creates a unique session ID and encryption key that all parties
 * will use to coordinate signing via the relay server.
 *
 * @returns Session parameters for MPC coordination
 *
 * @example
 * ```typescript
 * const { sessionId, hexEncryptionKey } = generateSharedSessionParams()
 * // Pass these to all signing parties
 * ```
 */
export function generateSharedSessionParams(): { sessionId: string; hexEncryptionKey: string } {
  return {
    sessionId: randomUUID(),
    hexEncryptionKey: generateHexEncryptionKey(),
  }
}

/**
 * Coordinate multi-party MPC signing across all shares
 *
 * This function orchestrates the MPC keysign protocol:
 * 1. All parties join the relay session
 * 2. First party starts the session
 * 3. All parties run keysign in parallel
 * 4. Returns the final signature
 *
 * @param shares - Array of vault share data (need threshold count)
 * @param params - Signing parameters
 * @returns Signature from the MPC protocol
 *
 * @example
 * ```typescript
 * const signature = await coordinateMultiPartySigning(
 *   [share1, share2],
 *   {
 *     sessionId,
 *     hexEncryptionKey,
 *     relayUrl: RELAY_URL,
 *     messageHashes: ['abc123...'],
 *     chainPath: "m/44'/60'/0'/0/0",
 *     signatureAlgorithm: 'ecdsa',
 *   }
 * )
 * ```
 */
export async function coordinateMultiPartySigning(
  shares: VaultShareData[],
  params: MultiPartySigningParams
): Promise<Signature> {
  const { sessionId, hexEncryptionKey, relayUrl, messageHashes, chainPath, signatureAlgorithm } = params

  if (shares.length < 2) {
    throw new Error('Multi-party signing requires at least 2 shares')
  }

  if (messageHashes.length === 0) {
    throw new Error('No message hashes provided for signing')
  }

  // All participating party IDs
  const allPartyIds = shares.map(s => s.localPartyId)

  console.log(`🔐 Starting multi-party signing with ${shares.length} parties`)
  console.log(`   Session ID: ${sessionId}`)
  console.log(`   Parties: ${allPartyIds.join(', ')}`)
  console.log(`   Message hashes: ${messageHashes.length}`)
  console.log(`   Signature algorithm: ${signatureAlgorithm}`)

  // Debug: Check keyshare format (using console.error to ensure visibility)
  shares.forEach((share, i) => {
    const ks = share.keyShares[signatureAlgorithm]
    console.error(`   Share ${i} (${share.localPartyId}):`)
    console.error(`     - keyShare type: ${typeof ks}`)
    console.error(`     - keyShare length: ${ks?.length || 'undefined'}`)
    console.error(`     - keyShare preview: ${ks?.substring(0, 50)}...`)
  })

  // Step 1: All parties join the session
  console.log('📡 Joining relay session...')
  await Promise.all(
    shares.map(share =>
      joinMpcSession({
        serverUrl: relayUrl,
        sessionId,
        localPartyId: share.localPartyId,
      })
    )
  )

  // Small delay for session registration
  await sleep(500)

  // Step 2: Start the session (first party initiates)
  console.log('🚀 Starting MPC session...')
  await startMpcSession({
    serverUrl: relayUrl,
    sessionId,
    devices: allPartyIds,
  })

  // Small delay for session start propagation
  await sleep(500)

  // Step 3: All parties run keysign in parallel
  // Each party signs the same message(s) and produces the same signature
  console.log('✍️  Running keysign protocol...')

  // For multi-message signing, we need to sign each hash
  // Most transactions have a single hash, but UTXO chains may have multiple
  const allSignatures: KeysignSignature[] = []

  for (let i = 0; i < messageHashes.length; i++) {
    const messageHash = messageHashes[i]
    console.log(`   Signing message ${i + 1}/${messageHashes.length}: ${messageHash.substring(0, 16)}...`)

    const signingPromises = shares.map((share, index) => {
      const peers = allPartyIds.filter(id => id !== share.localPartyId)
      const isInitiatingDevice = index === 0

      return keysign({
        keyShare: share.keyShares[signatureAlgorithm],
        signatureAlgorithm,
        message: messageHash,
        chainPath,
        localPartyId: share.localPartyId,
        peers,
        serverUrl: relayUrl,
        sessionId: `${sessionId}-${i}`, // Unique session per message
        hexEncryptionKey,
        isInitiatingDevice,
      })
    })

    // All parties should produce the same signature
    const signatures = await Promise.all(signingPromises)
    allSignatures.push(signatures[0]) // All signatures are identical
  }

  console.log('✅ Multi-party signing complete!')

  // Convert KeysignSignature to SDK Signature format
  const firstSig = allSignatures[0]
  return {
    signature: firstSig.der_signature,
    recovery: firstSig.recovery_id ? parseInt(firstSig.recovery_id, 16) : undefined,
    format: signatureAlgorithm === 'ecdsa' ? 'ECDSA' : 'EdDSA',
  }
}

/**
 * Get the threshold number of signers needed for a vault
 *
 * SecureVault uses (n+1)/2 threshold, meaning:
 * - 2 signers = 2-of-2 (both required)
 * - 3 signers = 2-of-3 (majority)
 * - 4 signers = 3-of-4 (majority)
 * - 5 signers = 3-of-5 (majority)
 *
 * @param totalSigners - Total number of signers in the vault
 * @returns Number of signers required to sign
 */
export function getThreshold(totalSigners: number): number {
  return Math.ceil((totalSigners + 1) / 2)
}

/**
 * Verify that all shares belong to the same vault
 *
 * Checks that all shares have identical public keys, which confirms
 * they are shares of the same vault.
 *
 * @param shares - Array of vault shares to verify
 * @throws Error if shares don't match
 */
export function verifySharesMatch(shares: VaultShareData[]): void {
  if (shares.length < 2) {
    throw new Error('Need at least 2 shares to verify')
  }

  const expectedEcdsa = shares[0].publicKeys.ecdsa
  const expectedEddsa = shares[0].publicKeys.eddsa

  for (const share of shares) {
    if (share.publicKeys.ecdsa !== expectedEcdsa) {
      throw new Error(`Share ${share.localPartyId} has different ECDSA public key - not from the same vault`)
    }
    if (share.publicKeys.eddsa !== expectedEddsa) {
      throw new Error(`Share ${share.localPartyId} has different EdDSA public key - not from the same vault`)
    }
  }
}

/**
 * Simple sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
