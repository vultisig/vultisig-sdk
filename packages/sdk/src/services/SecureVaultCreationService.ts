/**
 * SecureVaultCreationService - Orchestrates multi-device MPC vault creation
 *
 * This service coordinates the keygen ceremony for secure vaults:
 * 1. Generates session parameters
 * 2. Creates QR payload for mobile app pairing
 * 3. Manages relay session coordination
 * 4. Runs DKLS (ECDSA) + Schnorr (EdDSA) keygen
 */

import { create, toBinary } from '@bufbuild/protobuf'
import { toCompressedString } from '@core/chain/utils/protobuf/toCompressedString'
import { getSevenZip } from '@core/mpc/compression/getSevenZip'
import { generateLocalPartyId } from '@core/mpc/devices/localPartyId'
import { DKLS } from '@core/mpc/dkls/dkls'
import { getKeygenThreshold } from '@core/mpc/getKeygenThreshold'
import { setKeygenComplete, waitForKeygenComplete } from '@core/mpc/keygenComplete'
import { Schnorr } from '@core/mpc/schnorr/schnorrKeygen'
import { joinMpcSession } from '@core/mpc/session/joinMpcSession'
import { startMpcSession } from '@core/mpc/session/startMpcSession'
import { KeygenMessageSchema } from '@core/mpc/types/vultisig/keygen/v1/keygen_message_pb'
import { LibType } from '@core/mpc/types/vultisig/keygen/v1/lib_type_message_pb'
import { generateHexChainCode } from '@core/mpc/utils/generateHexChainCode'
import { generateHexEncryptionKey } from '@core/mpc/utils/generateHexEncryptionKey'
import { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { without } from '@lib/utils/array/without'
import { withoutDuplicates } from '@lib/utils/array/withoutDuplicates'
import { queryUrl } from '@lib/utils/query/queryUrl'

import { randomUUID } from '../crypto'

/**
 * Progress step during secure vault creation
 */
export type SecureVaultCreationStep = {
  step:
    | 'initializing'
    | 'generating_qr'
    | 'waiting_for_devices'
    | 'keygen_ecdsa'
    | 'keygen_eddsa'
    | 'finalizing'
    | 'complete'
  progress: number
  message: string
  sessionId?: string
  qrPayload?: string
  devicesJoined?: number
  devicesRequired?: number
}

/**
 * Options for creating a secure vault
 */
export type SecureVaultCreateOptions = {
  /** Vault name */
  name: string
  /** Optional password for vault encryption */
  password?: string
  /** Total number of devices participating (including this one) */
  devices: number
  /** Signing threshold - defaults to 2/3 majority (ceil(devices*2/3)) */
  threshold?: number
  /** AbortSignal for cancellation */
  signal?: AbortSignal
  /** Progress callback */
  onProgress?: (step: SecureVaultCreationStep) => void
  /** Callback when QR code payload is ready for display */
  onQRCodeReady?: (qrPayload: string) => void
  /** Callback when a device joins the session */
  onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
}

/**
 * Result of secure vault creation
 */
export type SecureVaultCreateResult = {
  vault: CoreVault
  vaultId: string
  sessionId: string
}

/**
 * SecureVaultCreationService
 *
 * Coordinates multi-device MPC keygen ceremony for secure vaults.
 * Compatible with Vultisig mobile apps for device pairing.
 */
export class SecureVaultCreationService {
  private readonly relayUrl: string

  constructor(relayUrl: string = 'https://api.vultisig.com/router') {
    this.relayUrl = relayUrl
  }

  /**
   * Calculate threshold from device count
   * Uses 2/3 majority formula - e.g., 2-of-2, 2-of-3, 3-of-4
   */
  calculateThreshold(devices: number): number {
    return getKeygenThreshold(devices)
  }

  /**
   * Generate session parameters for keygen ceremony
   */
  generateSessionParams(): {
    sessionId: string
    hexEncryptionKey: string
    hexChainCode: string
    localPartyId: string
  } {
    return {
      sessionId: randomUUID(),
      hexEncryptionKey: generateHexEncryptionKey(),
      hexChainCode: generateHexChainCode(),
      localPartyId: generateLocalPartyId('sdk'),
    }
  }

  /**
   * Generate QR code payload for mobile app pairing
   *
   * Creates a compressed protobuf payload in the format:
   * vultisig://?type=NewVault&tssType=Keygen&jsonData=<compressed_base64>
   */
  async generateQRPayload(params: {
    sessionId: string
    hexEncryptionKey: string
    hexChainCode: string
    localPartyId: string
    vaultName: string
  }): Promise<string> {
    // Create KeygenMessage protobuf
    const keygenMessage = create(KeygenMessageSchema, {
      sessionId: params.sessionId,
      hexChainCode: params.hexChainCode,
      serviceName: params.localPartyId,
      encryptionKeyHex: params.hexEncryptionKey,
      useVultisigRelay: true,
      vaultName: params.vaultName,
      libType: LibType.DKLS,
    })

    // Serialize to binary
    const binary = toBinary(KeygenMessageSchema, keygenMessage)

    // Compress with 7-zip (LZMA)
    const sevenZip = await getSevenZip()
    const compressedData = toCompressedString({ sevenZip, binary })

    // Build URL for mobile app
    const qrPayload = `vultisig://?type=NewVault&tssType=Keygen&jsonData=${encodeURIComponent(compressedData)}`

    return qrPayload
  }

  /**
   * Wait for peer devices to join the session
   */
  private async waitForPeers(
    sessionId: string,
    localPartyId: string,
    requiredDevices: number,
    signal?: AbortSignal,
    onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
  ): Promise<string[]> {
    const maxWaitTime = 300000 // 5 minutes for multi-device setup
    const checkInterval = 2000
    const startTime = Date.now()
    let lastJoinedCount = 0

    while (Date.now() - startTime < maxWaitTime) {
      // Check for abort
      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }

      try {
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
          const otherPeers = without(uniquePeers, localPartyId)
          return [localPartyId, ...otherPeers]
        }

        await new Promise(resolve => setTimeout(resolve, checkInterval))
      } catch {
        await new Promise(resolve => setTimeout(resolve, checkInterval))
      }
    }

    throw new Error(`Timeout waiting for devices. Got ${lastJoinedCount}/${requiredDevices} devices.`)
  }

  /**
   * Create a secure vault with multi-device MPC keygen
   *
   * @param options - Vault creation options
   * @returns Created vault, vault ID, and session ID
   */
  async createVault(options: SecureVaultCreateOptions): Promise<SecureVaultCreateResult> {
    const { name, devices, threshold: customThreshold, signal, onProgress, onQRCodeReady, onDeviceJoined } = options

    const reportProgress = (step: SecureVaultCreationStep) => {
      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }
      onProgress?.(step)
    }
    const threshold = customThreshold || this.calculateThreshold(devices)

    // Validate inputs
    if (devices < 2) {
      throw new Error('Secure vaults require at least 2 devices')
    }
    if (threshold > devices) {
      throw new Error('Threshold cannot exceed number of devices')
    }

    // Step 1: Initialize
    reportProgress({
      step: 'initializing',
      progress: 5,
      message: 'Generating session parameters...',
    })

    const sessionParams = this.generateSessionParams()
    const { sessionId, hexEncryptionKey, hexChainCode, localPartyId } = sessionParams

    // Step 2: Generate QR code
    reportProgress({
      step: 'generating_qr',
      progress: 10,
      message: 'Generating QR code for device pairing...',
      sessionId,
    })

    const qrPayload = await this.generateQRPayload({
      sessionId,
      hexEncryptionKey,
      hexChainCode,
      localPartyId,
      vaultName: name,
    })

    // Notify QR is ready via callback
    if (onQRCodeReady) {
      onQRCodeReady(qrPayload)
    }

    reportProgress({
      step: 'generating_qr',
      progress: 15,
      message: 'QR code ready - waiting for devices to scan...',
      sessionId,
      qrPayload,
    })

    // Step 3: Join relay session
    await joinMpcSession({
      serverUrl: this.relayUrl,
      sessionId,
      localPartyId,
    })

    // Step 4: Wait for all devices
    reportProgress({
      step: 'waiting_for_devices',
      progress: 20,
      message: `Waiting for ${devices} devices to join...`,
      sessionId,
      devicesJoined: 1,
      devicesRequired: devices,
    })

    const allDevices = await this.waitForPeers(
      sessionId,
      localPartyId,
      devices,
      signal,
      (deviceId, total, required) => {
        // Notify via callback
        if (onDeviceJoined) {
          onDeviceJoined(deviceId, total, required)
        }
        reportProgress({
          step: 'waiting_for_devices',
          progress: 20 + Math.floor((total / required) * 20),
          message: `${total}/${required} devices joined...`,
          sessionId,
          devicesJoined: total,
          devicesRequired: required,
        })
      }
    )

    // Step 5: Start MPC session
    reportProgress({
      step: 'waiting_for_devices',
      progress: 40,
      message: 'All devices ready! Starting keygen ceremony...',
      sessionId,
      devicesJoined: devices,
      devicesRequired: devices,
    })

    await startMpcSession({
      serverUrl: this.relayUrl,
      sessionId,
      devices: allDevices,
    })

    // Step 6: ECDSA keygen
    reportProgress({
      step: 'keygen_ecdsa',
      progress: 50,
      message: 'Generating ECDSA keys...',
      sessionId,
    })

    const dkls = new DKLS(
      { create: true },
      true, // isInitiateDevice
      this.relayUrl,
      sessionId,
      localPartyId,
      allDevices,
      [], // oldKeygenCommittee (empty for new vault)
      hexEncryptionKey
    )

    const ecdsaResult = await dkls.startKeygenWithRetry()

    // Check for abort before EdDSA keygen
    if (signal?.aborted) {
      throw new Error('Operation aborted')
    }

    // Step 7: EdDSA keygen
    reportProgress({
      step: 'keygen_eddsa',
      progress: 70,
      message: 'Generating EdDSA keys...',
      sessionId,
    })

    const setupMessage = dkls.getSetupMessage()
    const schnorr = new Schnorr(
      { create: true },
      true,
      this.relayUrl,
      sessionId,
      localPartyId,
      allDevices,
      [],
      hexEncryptionKey,
      setupMessage
    )

    const eddsaResult = await schnorr.startKeygenWithRetry()

    // Check for abort before finalization
    if (signal?.aborted) {
      throw new Error('Operation aborted')
    }

    // Step 8: Signal completion
    reportProgress({
      step: 'finalizing',
      progress: 85,
      message: 'Finalizing vault creation...',
      sessionId,
    })

    await setKeygenComplete({
      serverURL: this.relayUrl,
      sessionId,
      localPartyId,
    })

    // Wait for all peers to complete
    const peers = allDevices.filter(d => d !== localPartyId)
    await waitForKeygenComplete({
      serverURL: this.relayUrl,
      sessionId,
      peers,
    })

    // Step 9: Create vault object
    const vault: CoreVault = {
      name,
      publicKeys: {
        ecdsa: ecdsaResult.publicKey,
        eddsa: eddsaResult.publicKey,
      },
      localPartyId,
      signers: allDevices,
      hexChainCode: ecdsaResult.chaincode,
      keyShares: {
        ecdsa: ecdsaResult.keyshare,
        eddsa: eddsaResult.keyshare,
      },
      libType: 'DKLS',
      isBackedUp: false,
      order: 0,
      createdAt: Date.now(),
    }

    const vaultId = vault.publicKeys.ecdsa

    reportProgress({
      step: 'complete',
      progress: 100,
      message: 'Secure vault created successfully!',
      sessionId,
    })

    return {
      vault,
      vaultId,
      sessionId,
    }
  }
}
