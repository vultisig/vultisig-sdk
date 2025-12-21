/**
 * RelaySigningService - Multi-device MPC signing via relay server
 *
 * This service coordinates multi-device threshold signing for SecureVault.
 * Unlike FastSigningService (2-of-2 with server), this handles n-of-m
 * threshold signatures with mobile device coordination.
 *
 * Flow:
 * 1. Generate session params (sessionId, encryption key)
 * 2. Generate QR payload for mobile device pairing
 * 3. Join relay session and wait for devices
 * 4. Execute MPC keysign when threshold reached
 * 5. Return aggregated signature
 */
import { create, toBinary } from '@bufbuild/protobuf'
import { Chain } from '@core/chain/Chain'
import { getChainKind } from '@core/chain/ChainKind'
import { type SignatureAlgorithm, signatureAlgorithms } from '@core/chain/signing/SignatureAlgorithm'
import { toCompressedString } from '@core/chain/utils/protobuf/toCompressedString'
import { getSevenZip } from '@core/mpc/compression/getSevenZip'
import { generateLocalPartyId } from '@core/mpc/devices/localPartyId'
import { keysign } from '@core/mpc/keysign'
import type { KeysignSignature } from '@core/mpc/keysign/KeysignSignature'
import { joinMpcSession } from '@core/mpc/session/joinMpcSession'
import { startMpcSession } from '@core/mpc/session/startMpcSession'
import { KeysignMessageSchema, KeysignPayloadSchema } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { generateHexEncryptionKey } from '@core/mpc/utils/generateHexEncryptionKey'
import type { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { withoutDuplicates } from '@lib/utils/array/withoutDuplicates'
import { queryUrl } from '@lib/utils/query/queryUrl'

import { randomUUID } from '../crypto'
import type { Signature, SigningMode, SigningPayload, SigningStep } from '../types'

// Default relay server URL
const DEFAULT_RELAY_URL = 'https://api.vultisig.com/router'

/**
 * Progress step during relay signing
 */
export type RelaySigningStep =
  | 'initializing'
  | 'generating_qr'
  | 'waiting_for_devices'
  | 'signing'
  | 'finalizing'
  | 'complete'

/**
 * Options for relay signing
 */
export type RelaySigningOptions = {
  /** Progress callback - maps to SigningStep for consistency */
  onProgress?: (step: SigningStep) => void
  /** Callback when QR code is ready for display */
  onQRCodeReady?: (qrPayload: string) => void
  /** Callback when a device joins the signing session */
  onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
  /** Timeout in ms for waiting for devices (default: 5 minutes) */
  deviceTimeout?: number
  /** Polling interval for checking device joins (default: 1000ms) */
  pollInterval?: number
}

/**
 * Service for multi-device MPC signing via relay server
 */
export class RelaySigningService {
  private readonly relayUrl: string

  constructor(relayUrl: string = DEFAULT_RELAY_URL) {
    this.relayUrl = relayUrl
  }

  /**
   * Generate session parameters for a signing session
   */
  generateSessionParams(): {
    sessionId: string
    hexEncryptionKey: string
    localPartyId: string
  } {
    return {
      sessionId: randomUUID(),
      hexEncryptionKey: generateHexEncryptionKey(),
      localPartyId: generateLocalPartyId('extension'),
    }
  }

  /**
   * Generate a QR payload URL for mobile app pairing during keysign
   */
  async generateQRPayload(params: {
    sessionId: string
    hexEncryptionKey: string
    localPartyId: string
    vaultPublicKeyEcdsa: string
  }): Promise<string> {
    // Create KeysignPayload with minimal required fields
    const keysignPayload = create(KeysignPayloadSchema, {
      vaultPublicKeyEcdsa: params.vaultPublicKeyEcdsa,
      vaultLocalPartyId: params.localPartyId,
    })

    // Create KeysignMessage protobuf
    const keysignMessage = create(KeysignMessageSchema, {
      sessionId: params.sessionId,
      serviceName: params.localPartyId,
      encryptionKeyHex: params.hexEncryptionKey,
      keysignPayload,
      useVultisigRelay: true,
      payloadId: randomUUID(),
    })

    // Serialize to binary
    const binary = toBinary(KeysignMessageSchema, keysignMessage)

    // Compress with 7-zip (LZMA)
    const sevenZip = await getSevenZip()
    const compressedData = toCompressedString({ sevenZip, binary })

    // Build the QR payload URL
    const qrPayload = `vultisig://?type=SignTransaction&tssType=Keysign&jsonData=${encodeURIComponent(compressedData)}`

    return qrPayload
  }

  /**
   * Get signature algorithm for a chain
   */
  private getSignatureAlgorithm(chain: Chain): SignatureAlgorithm {
    const kind = getChainKind(chain)
    return signatureAlgorithms[kind]
  }

  /**
   * Wait for devices to join the signing session
   */
  private async waitForDevices(
    sessionId: string,
    localPartyId: string,
    requiredDevices: number,
    options: {
      timeout?: number
      pollInterval?: number
      onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
    } = {}
  ): Promise<string[]> {
    const { timeout = 300000, pollInterval = 2000, onDeviceJoined } = options
    const startTime = Date.now()
    let lastJoinedCount = 0

    while (Date.now() - startTime < timeout) {
      try {
        // Query the relay session to see who has joined (same approach as keygen)
        const url = `${this.relayUrl}/${sessionId}`
        const allPeers = await queryUrl<string[]>(url)
        const uniquePeers = withoutDuplicates(allPeers)

        // Notify about new devices
        if (uniquePeers.length > lastJoinedCount && onDeviceJoined) {
          const newDevices = uniquePeers.slice(lastJoinedCount)
          for (const device of newDevices) {
            onDeviceJoined(device, uniquePeers.length, requiredDevices)
          }
          lastJoinedCount = uniquePeers.length
        }

        // Check if we have enough devices
        if (uniquePeers.length >= requiredDevices) {
          // Ensure local party is first in the list
          const otherPeers = uniquePeers.filter(p => p !== localPartyId)
          return [localPartyId, ...otherPeers]
        }
      } catch {
        // Ignore polling errors, continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }

    throw new Error(`Timeout waiting for devices. Got ${lastJoinedCount}/${requiredDevices} devices.`)
  }

  /**
   * Perform signing with relay coordination
   *
   * @param vault CoreVault with loaded key shares
   * @param payload SigningPayload with chain and messageHashes
   * @param options Signing options including callbacks
   * @returns Signature result
   */
  async signWithRelay(
    vault: CoreVault,
    payload: SigningPayload,
    options: RelaySigningOptions = {}
  ): Promise<Signature> {
    const { onProgress, onQRCodeReady, onDeviceJoined, deviceTimeout, pollInterval } = options

    type StepType = 'preparing' | 'coordinating' | 'signing' | 'broadcasting' | 'complete'
    const reportProgress = (step: StepType, progress: number, message: string) => {
      if (onProgress) {
        onProgress({
          step,
          progress,
          message,
          mode: 'relay' as SigningMode,
          participantCount: vault.signers.length,
          participantsReady: 0,
        })
      }
    }

    try {
      // Step 1: Validate vault is a secure vault
      reportProgress('preparing', 5, 'Validating vault configuration')

      if (!vault.keyShares || Object.keys(vault.keyShares).length === 0) {
        throw new Error('Vault key shares not loaded. Call ensureKeySharesLoaded() first.')
      }

      const threshold = vault.signers.length > 2 ? Math.ceil((vault.signers.length + 1) / 2) : 2

      // Validate message hashes are provided
      if (!payload.messageHashes || payload.messageHashes.length === 0) {
        throw new Error(
          'SigningPayload must include pre-computed messageHashes. ' +
            'Use Vault.prepareSendTx() to generate transaction payloads with message hashes.'
        )
      }

      // Step 2: Generate session params
      reportProgress('preparing', 10, 'Generating session parameters')
      const { sessionId, hexEncryptionKey, localPartyId } = this.generateSessionParams()

      // Step 3: Get chain signing info
      const chain = payload.chain as Chain
      const signatureAlgorithm = this.getSignatureAlgorithm(chain)

      // Step 4: Generate QR payload
      reportProgress('preparing', 20, 'Generating QR code for device pairing')

      const qrPayload = await this.generateQRPayload({
        sessionId,
        hexEncryptionKey,
        localPartyId,
        vaultPublicKeyEcdsa: vault.publicKeys.ecdsa,
      })

      if (onQRCodeReady) {
        onQRCodeReady(qrPayload)
      }

      // Step 5: Join relay session
      reportProgress('coordinating', 25, 'Joining relay session')
      await joinMpcSession({
        serverUrl: this.relayUrl,
        sessionId,
        localPartyId,
      })

      // Step 6: Wait for other devices
      reportProgress('coordinating', 30, `Waiting for ${threshold} devices to join`)

      const devices = await this.waitForDevices(sessionId, localPartyId, threshold, {
        timeout: deviceTimeout,
        pollInterval,
        onDeviceJoined,
      })

      reportProgress('coordinating', 50, `All ${devices.length} devices connected`)

      // Step 7: Start MPC session
      reportProgress('signing', 55, 'Starting MPC signing session')
      await startMpcSession({
        serverUrl: this.relayUrl,
        sessionId,
        devices,
      })

      // Step 8: Get key share for signing
      const keyShareKey = signatureAlgorithm === 'ecdsa' ? 'ecdsa' : 'eddsa'
      const keyShare = vault.keyShares[keyShareKey]

      if (!keyShare) {
        throw new Error(`No ${keyShareKey} key share found in vault`)
      }

      // Step 9: Perform keysign for each message
      reportProgress('signing', 60, 'Executing threshold signature')

      const signatures: KeysignSignature[] = []
      const peers = devices.filter(d => d !== localPartyId)

      for (let i = 0; i < payload.messageHashes.length; i++) {
        const messageHash = payload.messageHashes[i]
        const progress = 60 + Math.floor((i / payload.messageHashes.length) * 30)
        reportProgress('signing', progress, `Signing message ${i + 1}/${payload.messageHashes.length}`)

        const signature = await keysign({
          keyShare,
          signatureAlgorithm,
          message: messageHash,
          chainPath: '', // Will be derived from chain
          localPartyId,
          peers,
          serverUrl: this.relayUrl,
          sessionId,
          hexEncryptionKey,
          isInitiatingDevice: true,
        })

        signatures.push(signature)
      }

      // Step 10: Format and return signature
      reportProgress('complete', 100, 'Signing complete')

      // Format signature matching SDK Signature type
      const formattedSignature: Signature = {
        signature: signatures[0]?.der_signature || '',
        recovery: signatures[0]?.recovery_id ? parseInt(signatures[0].recovery_id) : undefined,
        format: signatureAlgorithm === 'ecdsa' ? 'ECDSA' : 'EdDSA',
        signatures:
          signatures.length > 1
            ? signatures.map(sig => ({
                r: sig.r,
                s: sig.s,
                der: sig.der_signature,
              }))
            : undefined,
      }

      return formattedSignature
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error during signing'
      throw new Error(`Relay signing failed: ${message}`)
    }
  }

  /**
   * Sign raw bytes with relay coordination
   *
   * @param vault CoreVault with loaded key shares
   * @param bytesOptions Options containing messageHashes and chain
   * @param options Signing options including callbacks
   * @returns Signature result
   */
  async signBytesWithRelay(
    vault: CoreVault,
    bytesOptions: {
      messageHashes: string[]
      chain: Chain
    },
    options: RelaySigningOptions = {}
  ): Promise<Signature> {
    const { onProgress, onQRCodeReady, onDeviceJoined, deviceTimeout, pollInterval } = options

    type StepType = 'preparing' | 'coordinating' | 'signing' | 'broadcasting' | 'complete'
    const reportProgress = (step: StepType, progress: number, message: string) => {
      if (onProgress) {
        onProgress({
          step,
          progress,
          message,
          mode: 'relay' as SigningMode,
          participantCount: vault.signers.length,
          participantsReady: 0,
        })
      }
    }

    try {
      // Validate vault
      reportProgress('preparing', 5, 'Validating vault configuration')

      if (!vault.keyShares || Object.keys(vault.keyShares).length === 0) {
        throw new Error('Vault key shares not loaded.')
      }

      const threshold = vault.signers.length > 2 ? Math.ceil((vault.signers.length + 1) / 2) : 2

      // Generate session params
      reportProgress('preparing', 10, 'Generating session parameters')
      const { sessionId, hexEncryptionKey, localPartyId } = this.generateSessionParams()

      // Determine signature algorithm
      const signatureAlgorithm = this.getSignatureAlgorithm(bytesOptions.chain)

      // Generate QR payload
      reportProgress('preparing', 20, 'Generating QR code for device pairing')

      const qrPayload = await this.generateQRPayload({
        sessionId,
        hexEncryptionKey,
        localPartyId,
        vaultPublicKeyEcdsa: vault.publicKeys.ecdsa,
      })

      if (onQRCodeReady) {
        onQRCodeReady(qrPayload)
      }

      // Join relay session
      reportProgress('coordinating', 25, 'Joining relay session')
      await joinMpcSession({
        serverUrl: this.relayUrl,
        sessionId,
        localPartyId,
      })

      // Wait for devices
      reportProgress('coordinating', 30, `Waiting for ${threshold} devices to join`)

      const devices = await this.waitForDevices(sessionId, localPartyId, threshold, {
        timeout: deviceTimeout,
        pollInterval,
        onDeviceJoined,
      })

      // Start MPC session
      reportProgress('signing', 55, 'Starting MPC signing session')
      await startMpcSession({
        serverUrl: this.relayUrl,
        sessionId,
        devices,
      })

      // Get key share
      const keyShareKey = signatureAlgorithm === 'ecdsa' ? 'ecdsa' : 'eddsa'
      const keyShare = vault.keyShares[keyShareKey]

      if (!keyShare) {
        throw new Error(`No ${keyShareKey} key share found in vault`)
      }

      // Perform keysign
      reportProgress('signing', 60, 'Executing threshold signature')

      const signatures: KeysignSignature[] = []
      const peers = devices.filter(d => d !== localPartyId)

      for (const messageHash of bytesOptions.messageHashes) {
        const signature = await keysign({
          keyShare,
          signatureAlgorithm,
          message: messageHash,
          chainPath: '',
          localPartyId,
          peers,
          serverUrl: this.relayUrl,
          sessionId,
          hexEncryptionKey,
          isInitiatingDevice: true,
        })

        signatures.push(signature)
      }

      reportProgress('complete', 100, 'Signing complete')

      // Format signature
      const formattedSignature: Signature = {
        signature: signatures[0]?.der_signature || '',
        recovery: signatures[0]?.recovery_id ? parseInt(signatures[0].recovery_id) : undefined,
        format: signatureAlgorithm === 'ecdsa' ? 'ECDSA' : 'EdDSA',
        signatures:
          signatures.length > 1
            ? signatures.map(sig => ({
                r: sig.r,
                s: sig.s,
                der: sig.der_signature,
              }))
            : undefined,
      }

      return formattedSignature
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error during signing'
      throw new Error(`Relay bytes signing failed: ${message}`)
    }
  }
}
