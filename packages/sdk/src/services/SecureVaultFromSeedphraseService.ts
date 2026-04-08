/**
 * SecureVaultFromSeedphraseService - Creates a SecureVault from a seedphrase
 *
 * Orchestrates the full key import flow with multi-device coordination:
 * 1. Validate mnemonic
 * 2. Derive master keys
 * 3. Generate QR code for mobile pairing
 * 4. Wait for devices to join
 * 5. Run DKLS key import (ECDSA) for master key
 * 6. Run Schnorr key import (EdDSA) for master key
 * 7. Run per-chain key imports (DKLS or Schnorr based on chain type)
 * 8. Optionally discover chains with balances
 */
import { create, toBinary } from '@bufbuild/protobuf'
import type { Chain } from '@vultisig/core-chain/Chain'
import { toCompressedString } from '@vultisig/core-chain/utils/protobuf/toCompressedString'
import { getSevenZip } from '@vultisig/core-mpc/compression/getSevenZip'
import { generateLocalPartyId } from '@vultisig/core-mpc/devices/localPartyId'
import { DKLS } from '@vultisig/core-mpc/dkls/dkls'
import { getKeygenThreshold } from '@vultisig/core-mpc/getKeygenThreshold'
import { setKeygenComplete, waitForKeygenComplete } from '@vultisig/core-mpc/keygenComplete'
import { Schnorr } from '@vultisig/core-mpc/schnorr/schnorrKeygen'
import { joinMpcSession } from '@vultisig/core-mpc/session/joinMpcSession'
import { startMpcSession } from '@vultisig/core-mpc/session/startMpcSession'
import { KeygenMessageSchema } from '@vultisig/core-mpc/types/vultisig/keygen/v1/keygen_message_pb'
import { LibType } from '@vultisig/core-mpc/types/vultisig/keygen/v1/lib_type_message_pb'
import { generateHexChainCode } from '@vultisig/core-mpc/utils/generateHexChainCode'
import { generateHexEncryptionKey } from '@vultisig/core-mpc/utils/generateHexEncryptionKey'
import { Vault as CoreVault } from '@vultisig/core-mpc/vault/Vault'
import { withoutDuplicates } from '@vultisig/lib-utils/array/withoutDuplicates'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { DEFAULT_CHAINS } from '../constants'
import type { SdkContext } from '../context/SdkContext'
import { randomUUID } from '../crypto'
import { ChainDiscoveryService } from '../seedphrase/ChainDiscoveryService'
import { MasterKeyDeriver } from '../seedphrase/MasterKeyDeriver'
import { SeedphraseValidator } from '../seedphrase/SeedphraseValidator'
import type { ChainDiscoveryResult, CreateSecureVaultFromSeedphraseOptions } from '../seedphrase/types'
import type { VaultCreationStep } from '../types'
import { getChainBatchMessageIds, resolveTssBatching, TSS_BATCH_MESSAGE_IDS } from '../utils/tssBatching'
import { VaultError, VaultErrorCode } from '../vault/VaultError'

/**
 * SecureVaultFromSeedphraseService
 *
 * Creates a SecureVault from an existing BIP39 seedphrase via multi-device MPC.
 * Coordinates with mobile apps via QR code for device pairing.
 *
 * @example
 * ```typescript
 * const service = new SecureVaultFromSeedphraseService(context)
 * const result = await service.createFromSeedphrase({
 *   mnemonic: 'abandon abandon ... about',
 *   name: 'My Wallet',
 *   devices: 2,
 *   onQRCodeReady: (qrPayload) => displayQRCode(qrPayload),
 * })
 * ```
 */
export class SecureVaultFromSeedphraseService {
  private readonly validator: SeedphraseValidator
  private readonly keyDeriver: MasterKeyDeriver
  private readonly discoveryService: ChainDiscoveryService
  private readonly relayUrl: string

  constructor(private readonly context: SdkContext) {
    this.validator = new SeedphraseValidator(context.wasmProvider)
    this.keyDeriver = new MasterKeyDeriver(context.wasmProvider)
    this.discoveryService = new ChainDiscoveryService(context.wasmProvider)
    this.relayUrl = context.serverManager.messageRelay
  }

  /**
   * Calculate threshold from device count
   * Uses 2/3 majority formula - e.g., 2-of-2, 2-of-3, 3-of-4
   */
  calculateThreshold(devices: number): number {
    return getKeygenThreshold(devices)
  }

  /**
   * Generate QR code payload for mobile app pairing (key import)
   *
   * Creates a compressed protobuf payload in the format:
   * vultisig://?type=NewVault&tssType=Keygen&jsonData=<compressed_base64>
   */
  private async generateQRPayload(params: {
    sessionId: string
    hexEncryptionKey: string
    hexChainCode: string
    localPartyId: string
    vaultName: string
    chains: string[]
    tssBatching?: boolean
  }): Promise<string> {
    // Create KeygenMessage protobuf
    // For key import, include chains field so mobile apps know which chains to import
    const keygenMessage = create(KeygenMessageSchema, {
      sessionId: params.sessionId,
      hexChainCode: params.hexChainCode,
      serviceName: params.localPartyId,
      encryptionKeyHex: params.hexEncryptionKey,
      useVultisigRelay: true,
      vaultName: params.vaultName,
      libType: LibType.KEYIMPORT,
      chains: params.chains,
    })

    // Serialize to binary
    const binary = toBinary(KeygenMessageSchema, keygenMessage)

    // Compress with 7-zip (LZMA)
    const sevenZip = await getSevenZip()
    const compressedData = toCompressedString({ sevenZip, binary })

    // Build URL for mobile app
    const tssBatchingParam = params.tssBatching ? '&tssBatching=1' : ''
    const qrPayload = `vultisig://?type=NewVault&tssType=Keygen&jsonData=${encodeURIComponent(compressedData)}${tssBatchingParam}`

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
          // Must match JoinSecureVaultService: sorted committee so all parties use identical order
          return [...uniquePeers].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        }

        await new Promise(resolve => setTimeout(resolve, checkInterval))
      } catch {
        await new Promise(resolve => setTimeout(resolve, checkInterval))
      }
    }

    throw new VaultError(
      VaultErrorCode.Timeout,
      `Timeout waiting for devices. Got ${lastJoinedCount}/${requiredDevices} devices.`
    )
  }

  /**
   * Create a SecureVault from a seedphrase
   *
   * @param options - Creation options
   * @returns Creation result with vault and session information
   */
  async createFromSeedphrase(options: CreateSecureVaultFromSeedphraseOptions): Promise<{
    vault: CoreVault
    vaultId: string
    sessionId: string
    discoveredChains?: ChainDiscoveryResult[]
  }> {
    const {
      mnemonic,
      name,
      devices,
      threshold: customThreshold,
      signal,
      onProgress,
      onQRCodeReady,
      onDeviceJoined,
      onChainDiscovery,
    } = options
    const tssBatching = resolveTssBatching(this.context.config, options.tssBatching)

    const threshold = customThreshold || this.calculateThreshold(devices)

    const reportProgress = (step: VaultCreationStep) => {
      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }
      onProgress?.(step)
    }

    // Validate inputs
    if (devices < 2) {
      throw new VaultError(VaultErrorCode.InvalidConfig, 'Secure vaults require at least 2 devices')
    }
    if (threshold > devices) {
      throw new VaultError(VaultErrorCode.InvalidConfig, 'Threshold cannot exceed number of devices')
    }

    // Step 1: Validate mnemonic
    reportProgress({
      step: 'initializing',
      progress: 5,
      message: 'Validating seedphrase...',
    })

    const validation = await this.validator.validate(mnemonic)
    if (!validation.valid) {
      throw new VaultError(VaultErrorCode.InvalidConfig, `Invalid mnemonic: ${validation.error}`)
    }

    // Step 2: Derive master keys
    reportProgress({
      step: 'initializing',
      progress: 10,
      message: 'Deriving master keys...',
    })

    const masterKeys = await this.keyDeriver.deriveMasterKeys(mnemonic)

    // Step 3: Run optional chain discovery
    let discoveredChains: ChainDiscoveryResult[] | undefined
    let usePhantomSolanaPath = options.usePhantomSolanaPath ?? false

    if (options.discoverChains) {
      reportProgress({
        step: 'fetching_balances',
        progress: 15,
        message: 'Discovering chains with balances...',
      })

      const discoveryResult = await this.discoveryService.discoverChains(mnemonic, {
        config: { chains: options.chainsToScan },
        onProgress: onChainDiscovery,
      })
      discoveredChains = discoveryResult.results
      // Use discovered Phantom path preference unless explicitly set in options
      if (options.usePhantomSolanaPath === undefined) {
        usePhantomSolanaPath = discoveryResult.usePhantomSolanaPath
      }
    }

    // Determine which chains to import
    const chainsToImport =
      options.chains ?? discoveredChains?.filter(c => c.hasBalance).map(c => c.chain) ?? DEFAULT_CHAINS

    // Step 4: Generate session parameters
    reportProgress({
      step: 'initializing',
      progress: 20,
      message: 'Generating session parameters...',
    })

    const sessionId = randomUUID()
    const hexEncryptionKey = generateHexEncryptionKey()
    const hexChainCode = generateHexChainCode()
    const localPartyId = generateLocalPartyId('sdk')

    // Step 5: Generate QR code for device pairing
    reportProgress({
      step: 'initializing',
      progress: 22,
      message: 'Generating QR code for device pairing...',
    })

    const qrPayload = await this.generateQRPayload({
      sessionId,
      hexEncryptionKey,
      hexChainCode,
      localPartyId,
      vaultName: name,
      chains: chainsToImport,
      tssBatching,
    })

    // Notify QR is ready
    if (onQRCodeReady) {
      onQRCodeReady(qrPayload)
    }

    // Step 6: Join relay session
    reportProgress({
      step: 'initializing',
      progress: 25,
      message: 'Joining relay session...',
    })

    await joinMpcSession({
      serverUrl: this.relayUrl,
      sessionId,
      localPartyId,
    })

    // Step 7: Wait for all devices
    reportProgress({
      step: 'initializing',
      progress: 30,
      message: `Waiting for ${devices} devices to join...`,
    })

    const allDevices = await this.waitForPeers(
      sessionId,
      localPartyId,
      devices,
      signal,
      (deviceId, total, required) => {
        if (onDeviceJoined) {
          onDeviceJoined(deviceId, total, required)
        }
        reportProgress({
          step: 'initializing',
          progress: 30 + Math.floor((total / required) * 15),
          message: `${total}/${required} devices joined...`,
        })
      }
    )

    // Step 8: Start MPC session
    reportProgress({
      step: 'keygen',
      progress: 45,
      message: 'All devices ready! Starting key import...',
    })

    const { error: startErr } = await attempt(
      startMpcSession({
        serverUrl: this.relayUrl,
        sessionId,
        devices: allDevices,
      })
    )
    if (startErr) {
      console.warn('startMpcSession (seedphrase import):', startErr)
    }

    const dkls = new DKLS(
      { keyimport: true },
      true, // isInitiateDevice
      this.relayUrl,
      sessionId,
      localPartyId,
      allDevices,
      [], // oldKeygenCommittee
      hexEncryptionKey
    )

    const chainPublicKeys: Partial<Record<Chain, string>> = {}
    const chainKeyShares: Partial<Record<Chain, string>> = {}
    let ecdsaResult: { publicKey: string; keyshare: string; chaincode: string }
    let eddsaResult: { publicKey: string; keyshare: string; chaincode: string }
    const chainPrivateKeys = await this.keyDeriver.deriveChainPrivateKeys(mnemonic, chainsToImport as Chain[], {
      usePhantomSolanaPath,
    })

    if (tssBatching) {
      reportProgress({
        step: 'keygen',
        progress: 50,
        message: 'Importing ECDSA, EdDSA, and chain keys...',
      })

      const rootSchnorr = new Schnorr(
        { keyimport: true },
        true,
        this.relayUrl,
        sessionId,
        localPartyId,
        allDevices,
        [],
        hexEncryptionKey,
        new Uint8Array()
      )
      const chainImportPromises = chainPrivateKeys.map(async ({ chain, privateKeyHex, isEddsa }) => {
        const ids = getChainBatchMessageIds(chain)
        if (isEddsa) {
          const chainSchnorr = new Schnorr(
            { keyimport: true },
            true,
            this.relayUrl,
            sessionId,
            localPartyId,
            allDevices,
            [],
            hexEncryptionKey,
            new Uint8Array()
          )
          const result = await chainSchnorr.startKeyImportWithRetry(
            privateKeyHex,
            hexChainCode,
            ids.setupMessageId,
            ids.protocolMessageId
          )
          return { chain, result }
        }

        const chainDkls = new DKLS(
          { keyimport: true },
          true,
          this.relayUrl,
          sessionId,
          localPartyId,
          allDevices,
          [],
          hexEncryptionKey
        )
        const result = await chainDkls.startKeyImportWithRetry(
          privateKeyHex,
          hexChainCode,
          ids.setupMessageId,
          ids.protocolMessageId
        )
        return { chain, result }
      })

      const [rootEcdsa, rootEddsa, chainResults] = await Promise.all([
        dkls.startKeyImportWithRetry(
          masterKeys.ecdsaPrivateKeyHex,
          hexChainCode,
          undefined,
          TSS_BATCH_MESSAGE_IDS.ecdsa
        ),
        rootSchnorr.startKeyImportWithRetry(
          masterKeys.eddsaPrivateKeyHex,
          hexChainCode,
          TSS_BATCH_MESSAGE_IDS.eddsaImportSetup,
          TSS_BATCH_MESSAGE_IDS.eddsa
        ),
        Promise.all(chainImportPromises),
      ])

      ecdsaResult = rootEcdsa
      eddsaResult = rootEddsa
      chainResults.forEach(({ chain, result }) => {
        chainPublicKeys[chain] = result.publicKey
        chainKeyShares[chain] = result.keyshare
      })
    } else {
      reportProgress({
        step: 'keygen',
        progress: 50,
        message: 'Importing ECDSA key...',
      })

      ecdsaResult = await dkls.startKeyImportWithRetry(masterKeys.ecdsaPrivateKeyHex, hexChainCode)

      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }

      reportProgress({
        step: 'keygen',
        progress: 55,
        message: 'Importing EdDSA key...',
      })

      const schnorr = new Schnorr(
        { keyimport: true },
        true,
        this.relayUrl,
        sessionId,
        localPartyId,
        allDevices,
        [],
        hexEncryptionKey,
        dkls.getSetupMessage()
      )

      eddsaResult = await schnorr.startKeyImportWithRetry(masterKeys.eddsaPrivateKeyHex, hexChainCode)

      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }

      reportProgress({
        step: 'keygen',
        progress: 65,
        message: 'Importing chain-specific keys...',
      })

      for (let i = 0; i < chainPrivateKeys.length; i++) {
        if (signal?.aborted) {
          throw new Error('Operation aborted')
        }

        const { chain, privateKeyHex, isEddsa } = chainPrivateKeys[i]

        reportProgress({
          step: 'keygen',
          progress: 65 + Math.floor((i / chainPrivateKeys.length) * 25),
          message: `Importing ${chain} key (${i + 1}/${chainPrivateKeys.length})...`,
          chainId: chain,
        })

        if (isEddsa) {
          const chainSchnorr = new Schnorr(
            { keyimport: true },
            true,
            this.relayUrl,
            sessionId,
            localPartyId,
            allDevices,
            [],
            hexEncryptionKey,
            new Uint8Array()
          )
          const chainResult = await chainSchnorr.startKeyImportWithRetry(privateKeyHex, eddsaResult.chaincode, chain)
          chainPublicKeys[chain] = chainResult.publicKey
          chainKeyShares[chain] = chainResult.keyshare
        } else {
          const chainDkls = new DKLS(
            { keyimport: true },
            true,
            this.relayUrl,
            sessionId,
            localPartyId,
            allDevices,
            [],
            hexEncryptionKey
          )
          const chainResult = await chainDkls.startKeyImportWithRetry(privateKeyHex, ecdsaResult.chaincode, chain)
          chainPublicKeys[chain] = chainResult.publicKey
          chainKeyShares[chain] = chainResult.keyshare
        }
      }
    }

    // Step 12: Signal completion
    reportProgress({
      step: 'keygen',
      progress: 90,
      message: 'Finalizing key import...',
    })

    await setKeygenComplete({
      serverURL: this.relayUrl,
      sessionId,
      localPartyId,
    })

    // Wait for peer completion with tolerance for import flows
    // Other devices may complete at different rates, and since MPC already
    // succeeded (we have the keys), this is just a secondary check
    const peers = allDevices.filter(d => d !== localPartyId)
    try {
      await waitForKeygenComplete({
        serverURL: this.relayUrl,
        sessionId,
        peers,
      })
    } catch {
      // For key import, if MPC succeeded but peers didn't all signal completion,
      // we can proceed since we have valid keys from the completed MPC exchange
      console.warn('Not all peer completion signals received, proceeding with valid MPC keys')
    }

    // Step 14: Build vault structure
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
      chainPublicKeys,
      chainKeyShares,
    }

    reportProgress({
      step: 'complete',
      progress: 100,
      message: 'Key import complete!',
    })

    return {
      vault,
      vaultId: vault.publicKeys.ecdsa,
      sessionId,
      discoveredChains,
    }
  }
}
