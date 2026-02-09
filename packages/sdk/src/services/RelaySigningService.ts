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
import { Chain } from '@core/chain/Chain'
import { getJoinKeysignUrl } from '@core/chain/utils/getJoinKeysignUrl'
import { generateLocalPartyId } from '@core/mpc/devices/localPartyId'
import { keysign } from '@core/mpc/keysign'
import type { KeysignSignature } from '@core/mpc/keysign/KeysignSignature'
import { joinMpcSession } from '@core/mpc/session/joinMpcSession'
import { startMpcSession } from '@core/mpc/session/startMpcSession'
import type { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { generateHexEncryptionKey } from '@core/mpc/utils/generateHexEncryptionKey'
import type { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { withoutDuplicates } from '@lib/utils/array/withoutDuplicates'
import { queryUrl } from '@lib/utils/query/queryUrl'
import type { WalletCore } from '@trustwallet/wallet-core'

import { formatSignature } from '../adapters/formatSignature'
import { getChainSigningInfo } from '../adapters/getChainSigningInfo'
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
  /** AbortSignal for cancellation */
  signal?: AbortSignal
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
      localPartyId: generateLocalPartyId('sdk'),
    }
  }

  /**
   * Generate a QR payload URL for mobile app pairing during keysign
   *
   * @param params Session parameters and optional keysign payload
   * @param params.keysignPayload Full transaction payload (coin, toAddress, toAmount, blockchainSpecific)
   *                              If provided, mobile app can display transaction details.
   *                              If omitted (e.g., for signBytes), creates minimal session-only payload.
   */
  async generateQRPayload(params: {
    sessionId: string
    hexEncryptionKey: string
    localPartyId: string
    vaultPublicKeyEcdsa: string
    keysignPayload?: KeysignPayload
  }): Promise<string> {
    // Use core function which handles:
    // - Full payload serialization with all transaction details
    // - Automatic upload to server if payload exceeds URL length limit (2048 chars)
    // - Consistent behavior with vultisig-windows mobile apps
    return getJoinKeysignUrl({
      serverType: 'relay',
      serviceName: params.localPartyId,
      sessionId: params.sessionId,
      hexEncryptionKey: params.hexEncryptionKey,
      payload: params.keysignPayload ? { keysign: params.keysignPayload } : undefined,
      vaultId: params.vaultPublicKeyEcdsa,
    })
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
      signal?: AbortSignal
      onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
      onProgress?: (step: SigningStep) => void
    } = {}
  ): Promise<string[]> {
    const { timeout = 300000, pollInterval = 2000, signal, onDeviceJoined, onProgress } = options
    const startTime = Date.now()
    let lastJoinedCount = 0

    while (Date.now() - startTime < timeout) {
      // Check for abort via signal
      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }

      try {
        // Query the relay session to see who has joined (same approach as keygen)
        const url = `${this.relayUrl}/${sessionId}`
        const allPeers = await queryUrl<string[]>(url)
        const uniquePeers = withoutDuplicates(allPeers)

        // Report progress
        onProgress?.({
          step: 'coordinating',
          progress: 30,
          message: `Waiting for ${requiredDevices - uniquePeers.length} more devices...`,
          mode: 'relay' as SigningMode,
          participantsReady: uniquePeers.length,
          participantCount: requiredDevices,
        })

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
      } catch (error) {
        // Re-throw abort errors
        if (error instanceof Error && error.message === 'Operation aborted') {
          throw error
        }
        // Ignore other polling errors, continue waiting
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
   * @param walletCore WalletCore instance for chain utilities
   * @param options Signing options including callbacks
   * @returns Signature result
   */
  async signWithRelay(
    vault: CoreVault,
    payload: SigningPayload,
    walletCore: WalletCore,
    options: RelaySigningOptions = {}
  ): Promise<Signature> {
    const { signal, onProgress, onQRCodeReady, onDeviceJoined, deviceTimeout, pollInterval } = options

    type StepType = 'preparing' | 'coordinating' | 'signing' | 'broadcasting' | 'complete'
    const reportProgress = (step: StepType, progress: number, message: string, participantsReady = 0) => {
      // Check for abort via signal
      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }
      onProgress?.({
        step,
        progress,
        message,
        mode: 'relay' as SigningMode,
        participantCount: vault.signers.length,
        participantsReady,
      })
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

      // Step 3: Get chain signing info (signature algorithm and derivation path)
      const chain = payload.chain as Chain
      const { signatureAlgorithm, chainPath } = getChainSigningInfo(
        { chain, derivePath: payload.derivePath },
        walletCore
      )

      // Step 4: Generate QR payload with full transaction details
      reportProgress('preparing', 20, 'Generating QR code for device pairing')

      const qrPayload = await this.generateQRPayload({
        sessionId,
        hexEncryptionKey,
        localPartyId,
        vaultPublicKeyEcdsa: vault.publicKeys.ecdsa,
        keysignPayload: payload.transaction as KeysignPayload,
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
        signal,
        onDeviceJoined,
        onProgress,
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
          chainPath,
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

      // Build signature results map for formatSignature adapter
      const signatureResults: Record<string, KeysignSignature> = {}
      for (let i = 0; i < payload.messageHashes.length; i++) {
        signatureResults[payload.messageHashes[i]] = signatures[i]
      }

      // Use formatSignature adapter for correct ECDSA/EdDSA handling
      const formattedSignature = formatSignature(signatureResults, payload.messageHashes, signatureAlgorithm)

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
   * @param walletCore WalletCore instance for chain utilities
   * @param options Signing options including callbacks
   * @returns Signature result
   */
  async signBytesWithRelay(
    vault: CoreVault,
    bytesOptions: {
      messageHashes: string[]
      chain: Chain
    },
    walletCore: WalletCore,
    options: RelaySigningOptions = {}
  ): Promise<Signature> {
    const { signal, onProgress, onQRCodeReady, onDeviceJoined, deviceTimeout, pollInterval } = options

    type StepType = 'preparing' | 'coordinating' | 'signing' | 'broadcasting' | 'complete'
    const reportProgress = (step: StepType, progress: number, message: string, participantsReady = 0) => {
      // Check for abort via signal
      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }
      onProgress?.({
        step,
        progress,
        message,
        mode: 'relay' as SigningMode,
        participantCount: vault.signers.length,
        participantsReady,
      })
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

      // Determine signature algorithm and derivation path
      const { signatureAlgorithm, chainPath } = getChainSigningInfo({ chain: bytesOptions.chain }, walletCore)

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
        signal,
        onDeviceJoined,
        onProgress,
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
          chainPath,
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

      // Build signature results map for formatSignature adapter
      const signatureResults: Record<string, KeysignSignature> = {}
      for (let i = 0; i < bytesOptions.messageHashes.length; i++) {
        signatureResults[bytesOptions.messageHashes[i]] = signatures[i]
      }

      // Use formatSignature adapter for correct ECDSA/EdDSA handling
      const formattedSignature = formatSignature(signatureResults, bytesOptions.messageHashes, signatureAlgorithm)

      return formattedSignature
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error during signing'
      throw new Error(`Relay bytes signing failed: ${message}`)
    }
  }
}
