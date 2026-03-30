/**
 * JoinSecureVaultService - Joins an existing SecureVault creation session as a non-initiator
 *
 * This is the counterpart to SecureVaultCreationService and SecureVaultFromSeedphraseService.
 * It supports joining both:
 * 1. Fresh keygen sessions (createSecureVault) - no seedphrase needed
 * 2. From-seedphrase sessions (createSecureVaultFromSeedphrase) - seedphrase required
 *
 * The mode is auto-detected from the QR payload's libType field.
 */
import type { Chain } from '@vultisig/core-chain/Chain'
import { generateLocalPartyId } from '@vultisig/core-mpc/devices/localPartyId'
import { DKLS } from '@vultisig/core-mpc/dkls/dkls'
import { setKeygenComplete, waitForKeygenComplete } from '@vultisig/core-mpc/keygenComplete'
import { MldsaKeygen } from '@vultisig/core-mpc/mldsa/mldsaKeygen'
import { Schnorr } from '@vultisig/core-mpc/schnorr/schnorrKeygen'
import { joinMpcSession } from '@vultisig/core-mpc/session/joinMpcSession'
import { startMpcSession } from '@vultisig/core-mpc/session/startMpcSession'
import { Vault as CoreVault } from '@vultisig/core-mpc/vault/Vault'
import { withoutDuplicates } from '@vultisig/lib-utils/array/withoutDuplicates'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import type { SdkContext } from '../context/SdkContext'
import { MasterKeyDeriver } from '../seedphrase/MasterKeyDeriver'
import { SeedphraseValidator } from '../seedphrase/SeedphraseValidator'
import type { JoinSecureVaultOptions } from '../seedphrase/types'
import type { VaultCreationStep } from '../types'
import type { ParsedKeygenQR } from '../utils/parseKeygenQR'
import {
  getChainBatchMessageIds,
  TSS_BATCH_MESSAGE_IDS,
} from '../utils/tssBatching'
import { VaultError, VaultErrorCode } from '../vault/VaultError'

/**
 * JoinSecureVaultService
 *
 * Joins an existing SecureVault creation session initiated by another device.
 * Supports both fresh keygen and from-seedphrase modes.
 */
export class JoinSecureVaultService {
  private readonly validator: SeedphraseValidator
  private readonly keyDeriver: MasterKeyDeriver

  private get relayUrl(): string {
    return this.context.serverManager.messageRelay
  }

  constructor(private readonly context: SdkContext) {
    this.validator = new SeedphraseValidator(context.wasmProvider)
    this.keyDeriver = new MasterKeyDeriver(context.wasmProvider)
  }

  /**
   * Wait for all devices to join the session
   */
  private async waitForPeers(
    sessionId: string,
    localPartyId: string,
    requiredDevices: number,
    signal?: AbortSignal,
    onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
  ): Promise<string[]> {
    const maxWaitTime = 300000 // 5 minutes
    const checkInterval = 2000
    const startTime = Date.now()
    let lastJoinedCount = 0

    while (Date.now() - startTime < maxWaitTime) {
      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }

      const url = `${this.relayUrl}/${sessionId}`
      const { data: allPeers, error } = await attempt(queryUrl<string[]>(url))

      if (error || !allPeers) {
        await new Promise(resolve => setTimeout(resolve, checkInterval))
        continue
      }

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
        // Must match initiator (SecureVaultCreationService / SecureVaultFromSeedphraseService)
        return [...uniquePeers].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval))
    }

    throw new VaultError(
      VaultErrorCode.NetworkError,
      `Timeout waiting for devices. Got ${lastJoinedCount}/${requiredDevices} devices.`
    )
  }

  /**
   * Join an existing SecureVault creation session.
   * Auto-detects keygen vs from-seedphrase mode from QR's libType.
   *
   * @param qrParams - Parsed QR payload from initiator
   * @param options - Join options (mnemonic required for from-seedphrase mode)
   * @returns CoreVault with generated/imported keys
   */
  async join(
    qrParams: ParsedKeygenQR,
    options: JoinSecureVaultOptions
  ): Promise<{
    vault: CoreVault
    vaultId: string
  }> {
    // Route based on libType
    if (qrParams.libType === 'KEYIMPORT') {
      // From-seedphrase mode - mnemonic required
      if (!options.mnemonic) {
        throw new VaultError(
          VaultErrorCode.InvalidConfig,
          'Mnemonic is required for joining a seedphrase-based vault creation session'
        )
      }
      return this.joinFromSeedphrase(qrParams, options)
    } else {
      // Fresh keygen mode - no mnemonic needed
      return this.joinKeygen(qrParams, options)
    }
  }

  /**
   * Join a fresh keygen session (no seedphrase)
   */
  private async joinKeygen(
    qrParams: ParsedKeygenQR,
    options: JoinSecureVaultOptions
  ): Promise<{ vault: CoreVault; vaultId: string }> {
    const { signal, onProgress, onDeviceJoined } = options
    const tssBatching = qrParams.tssBatching ?? false
    const requiredDevices = shouldBePresent(
      options.devices,
      'devices count is required when joining a SecureVault session'
    )

    const reportProgress = (step: VaultCreationStep) => {
      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }
      onProgress?.(step)
    }

    // Step 1: Generate local party ID
    reportProgress({
      step: 'keygen',
      progress: 10,
      message: 'Generating party ID...',
    })

    const localPartyId = generateLocalPartyId('sdk')

    // Step 2: Join relay session
    reportProgress({
      step: 'keygen',
      progress: 15,
      message: 'Joining session...',
    })

    await joinMpcSession({
      serverUrl: this.relayUrl,
      sessionId: qrParams.sessionId,
      localPartyId,
    })

    // Step 3: Wait for all devices
    reportProgress({
      step: 'keygen',
      progress: 20,
      message: `Waiting for ${requiredDevices} devices to join...`,
    })

    const allDevices = await this.waitForPeers(
      qrParams.sessionId,
      localPartyId,
      requiredDevices,
      signal,
      (deviceId, total, required) => {
        onDeviceJoined?.(deviceId, total, required)
        reportProgress({
          step: 'keygen',
          progress: 20 + Math.floor((total / required) * 20),
          message: `${total}/${required} devices joined...`,
        })
      }
    )

    // Fresh keygen only: joiners call /start too so no one runs DKLS before the relay opens the session.
    // (Key-import joiners must NOT call /start — only the initiator does — or import hangs.)
    const { error: startErr } = await attempt(
      startMpcSession({
        serverUrl: this.relayUrl,
        sessionId: qrParams.sessionId,
        devices: allDevices,
      })
    )
    if (startErr) {
      console.warn('startMpcSession (join keygen):', startErr)
    }

    const dkls = new DKLS(
      { create: true }, // Keygen mode
      false, // isInitiateDevice = false (joiner)
      this.relayUrl,
      qrParams.sessionId,
      localPartyId,
      allDevices,
      [], // oldKeygenCommittee
      qrParams.hexEncryptionKey
    )

    let mldsaResult: { publicKey: string; keyshare: string } | undefined
    let ecdsaResult: { publicKey: string; keyshare: string; chaincode: string }
    let eddsaResult: { publicKey: string; keyshare: string; chaincode: string }

    if (tssBatching) {
      reportProgress({
        step: 'keygen',
        progress: 45,
        message: 'Generating ECDSA, EdDSA, and ML-DSA keys...',
      })

      await dkls.prepareKeygenSetup()
      const schnorr = new Schnorr(
        { create: true },
        false,
        this.relayUrl,
        qrParams.sessionId,
        localPartyId,
        allDevices,
        [],
        qrParams.hexEncryptionKey,
        dkls.getSetupMessage()
      )
      const batchMldsa = new MldsaKeygen(
        false,
        this.relayUrl,
        qrParams.sessionId,
        localPartyId,
        allDevices,
        qrParams.hexEncryptionKey,
        {
          timeoutMs: 30000,
          messageId: TSS_BATCH_MESSAGE_IDS.mldsa,
          setupMessageId: TSS_BATCH_MESSAGE_IDS.mldsaSetup,
        }
      )

      const batchMldsaPromise = batchMldsa
        .startKeygenWithRetry()
        .catch(error => {
          console.warn(
            'ML-DSA keygen failed (non-fatal):',
            error instanceof Error ? error.message : error
          )
          return undefined
        })

      ;[ecdsaResult, eddsaResult, mldsaResult] = await Promise.all([
        dkls.startKeygenWithRetry(TSS_BATCH_MESSAGE_IDS.ecdsa),
        schnorr.startKeygenWithRetry(TSS_BATCH_MESSAGE_IDS.eddsa),
        batchMldsaPromise,
      ])
    } else {
      reportProgress({
        step: 'keygen',
        progress: 45,
        message: 'Generating ECDSA key...',
      })

      ecdsaResult = await dkls.startKeygenWithRetry()

      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }

      reportProgress({
        step: 'keygen',
        progress: 70,
        message: 'Generating EdDSA key...',
      })

      const schnorr = new Schnorr(
        { create: true },
        false,
        this.relayUrl,
        qrParams.sessionId,
        localPartyId,
        allDevices,
        [],
        qrParams.hexEncryptionKey,
        dkls.getSetupMessage()
      )

      eddsaResult = await schnorr.startKeygenWithRetry()

      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }

      reportProgress({
        step: 'keygen',
        progress: 80,
        message: 'Generating ML-DSA keys...',
      })

      try {
        const mldsaKeygen = new MldsaKeygen(
          false,
          this.relayUrl,
          qrParams.sessionId,
          localPartyId,
          allDevices,
          qrParams.hexEncryptionKey,
          { timeoutMs: 30000 }
        )

        mldsaResult = await mldsaKeygen.startKeygenWithRetry()
      } catch (error) {
        console.warn(
          'ML-DSA keygen failed (non-fatal):',
          error instanceof Error ? error.message : error
        )
      }
    }

    if (signal?.aborted) {
      throw new Error('Operation aborted')
    }

    // Step 6: Signal completion
    reportProgress({
      step: 'keygen',
      progress: 90,
      message: 'Finalizing keygen...',
    })

    await setKeygenComplete({
      serverURL: this.relayUrl,
      sessionId: qrParams.sessionId,
      localPartyId,
    })

    // Wait for peer completion with tolerance
    const peers = allDevices.filter(d => d !== localPartyId)
    const { error: peerCompleteError } = await attempt(
      waitForKeygenComplete({
        serverURL: this.relayUrl,
        sessionId: qrParams.sessionId,
        peers,
      })
    )
    if (peerCompleteError) {
      console.warn('Not all peer completion signals received, proceeding with valid MPC keys')
    }

    // Step 7: Build vault structure
    const vault: CoreVault = {
      name: qrParams.vaultName,
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
      publicKeyMldsa: mldsaResult?.publicKey,
      keyShareMldsa: mldsaResult?.keyshare,
      libType: 'DKLS',
      isBackedUp: false,
      order: 0,
      createdAt: Date.now(),
    }

    reportProgress({
      step: 'complete',
      progress: 100,
      message: 'Keygen complete!',
    })

    return {
      vault,
      vaultId: vault.publicKeys.ecdsa,
    }
  }

  /**
   * Join a from-seedphrase session (mnemonic required)
   */
  private async joinFromSeedphrase(
    qrParams: ParsedKeygenQR,
    options: JoinSecureVaultOptions
  ): Promise<{ vault: CoreVault; vaultId: string }> {
    const { mnemonic, signal, onProgress, onDeviceJoined } = options
    const tssBatching = qrParams.tssBatching ?? false
    const requiredDevices = shouldBePresent(
      options.devices,
      'devices count is required when joining a SecureVault session'
    )

    const reportProgress = (step: VaultCreationStep) => {
      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }
      onProgress?.(step)
    }

    // Step 1: Validate mnemonic
    reportProgress({
      step: 'initializing',
      progress: 5,
      message: 'Validating seedphrase...',
    })

    const validation = await this.validator.validate(mnemonic!)
    if (!validation.valid) {
      throw new VaultError(VaultErrorCode.InvalidConfig, `Invalid mnemonic: ${validation.error}`)
    }

    // Step 2: Derive master keys
    reportProgress({
      step: 'initializing',
      progress: 10,
      message: 'Deriving master keys...',
    })

    const masterKeys = await this.keyDeriver.deriveMasterKeys(mnemonic!)

    // Step 3: Generate local party ID
    reportProgress({
      step: 'keygen',
      progress: 15,
      message: 'Generating party ID...',
    })

    const localPartyId = generateLocalPartyId('sdk')

    // Step 4: Join relay session
    reportProgress({
      step: 'keygen',
      progress: 20,
      message: 'Joining session...',
    })

    await joinMpcSession({
      serverUrl: this.relayUrl,
      sessionId: qrParams.sessionId,
      localPartyId,
    })

    // Step 5: Wait for all devices
    reportProgress({
      step: 'keygen',
      progress: 25,
      message: `Waiting for ${requiredDevices} devices to join...`,
    })

    const allDevices = await this.waitForPeers(
      qrParams.sessionId,
      localPartyId,
      requiredDevices,
      signal,
      (deviceId, total, required) => {
        onDeviceJoined?.(deviceId, total, required)
        reportProgress({
          step: 'keygen',
          progress: 25 + Math.floor((total / required) * 15),
          message: `${total}/${required} devices joined...`,
        })
      }
    )

    // Key import: only the initiator calls startMpcSession (same as mobile); joiners go straight to DKLS.

    const dkls = new DKLS(
      { keyimport: true },
      false, // isInitiateDevice = false (joiner)
      this.relayUrl,
      qrParams.sessionId,
      localPartyId,
      allDevices,
      [], // oldKeygenCommittee
      qrParams.hexEncryptionKey
    )

    let mldsaResult: { publicKey: string; keyshare: string } | undefined
    const chainPublicKeys: Partial<Record<Chain, string>> = {}
    const chainKeyShares: Partial<Record<Chain, string>> = {}
    let ecdsaResult: { publicKey: string; keyshare: string; chaincode: string }
    let eddsaResult: { publicKey: string; keyshare: string; chaincode: string }

    if (tssBatching) {
      reportProgress({
        step: 'keygen',
        progress: 45,
        message: 'Importing ECDSA, EdDSA, ML-DSA, and chain keys...',
      })

      const rootSchnorr = new Schnorr(
        { keyimport: true },
        false,
        this.relayUrl,
        qrParams.sessionId,
        localPartyId,
        allDevices,
        [],
        qrParams.hexEncryptionKey,
        new Uint8Array()
      )
      const batchMldsa = new MldsaKeygen(
        false,
        this.relayUrl,
        qrParams.sessionId,
        localPartyId,
        allDevices,
        qrParams.hexEncryptionKey,
        {
          timeoutMs: 30000,
          messageId: TSS_BATCH_MESSAGE_IDS.mldsa,
          setupMessageId: TSS_BATCH_MESSAGE_IDS.mldsaSetup,
        }
      )
      const chainPrivateKeys =
        qrParams.chains && qrParams.chains.length > 0
          ? await this.keyDeriver.deriveChainPrivateKeys(
              mnemonic!,
              qrParams.chains as Chain[]
            )
          : []

      const chainImportPromises = chainPrivateKeys.map(
        async ({ chain, privateKeyHex, isEddsa }) => {
          const ids = getChainBatchMessageIds(chain)
          if (isEddsa) {
            const chainSchnorr = new Schnorr(
              { keyimport: true },
              false,
              this.relayUrl,
              qrParams.sessionId,
              localPartyId,
              allDevices,
              [],
              qrParams.hexEncryptionKey,
              new Uint8Array()
            )
            const result = await chainSchnorr.startKeyImportWithRetry(
              privateKeyHex,
              qrParams.hexChainCode,
              ids.setupMessageId,
              ids.protocolMessageId
            )
            return { chain, result }
          }

          const chainDkls = new DKLS(
            { keyimport: true },
            false,
            this.relayUrl,
            qrParams.sessionId,
            localPartyId,
            allDevices,
            [],
            qrParams.hexEncryptionKey
          )
          const result = await chainDkls.startKeyImportWithRetry(
            privateKeyHex,
            qrParams.hexChainCode,
            ids.setupMessageId,
            ids.protocolMessageId
          )
          return { chain, result }
        }
      )

      const batchMldsaPromise = batchMldsa
        .startKeygenWithRetry()
        .catch(error => {
          console.warn(
            'ML-DSA keygen failed (non-fatal):',
            error instanceof Error ? error.message : error
          )
          return undefined
        })

      const [rootEcdsa, rootEddsa, chainResults, batchMldsaResult] =
        await Promise.all([
          dkls.startKeyImportWithRetry(
            masterKeys.ecdsaPrivateKeyHex,
            qrParams.hexChainCode,
            undefined,
            TSS_BATCH_MESSAGE_IDS.ecdsa
          ),
          rootSchnorr.startKeyImportWithRetry(
            masterKeys.eddsaPrivateKeyHex,
            qrParams.hexChainCode,
            TSS_BATCH_MESSAGE_IDS.eddsaImportSetup,
            TSS_BATCH_MESSAGE_IDS.eddsa
          ),
          Promise.all(chainImportPromises),
          batchMldsaPromise,
        ])

      ecdsaResult = rootEcdsa
      eddsaResult = rootEddsa
      mldsaResult = batchMldsaResult
      chainResults.forEach(({ chain, result }) => {
        chainPublicKeys[chain] = result.publicKey
        chainKeyShares[chain] = result.keyshare
      })
    } else {
      reportProgress({
        step: 'keygen',
        progress: 45,
        message: 'Importing ECDSA key...',
      })

      ecdsaResult = await dkls.startKeyImportWithRetry(
        masterKeys.ecdsaPrivateKeyHex,
        qrParams.hexChainCode
      )

      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }

      reportProgress({
        step: 'keygen',
        progress: 65,
        message: 'Importing EdDSA key...',
      })

      const schnorr = new Schnorr(
        { keyimport: true },
        false,
        this.relayUrl,
        qrParams.sessionId,
        localPartyId,
        allDevices,
        [],
        qrParams.hexEncryptionKey,
        new Uint8Array()
      )

      eddsaResult = await schnorr.startKeyImportWithRetry(
        masterKeys.eddsaPrivateKeyHex,
        ecdsaResult.chaincode
      )

      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }

      reportProgress({
        step: 'keygen',
        progress: 70,
        message: 'Generating ML-DSA keys...',
      })

      try {
        const mldsaKeygen = new MldsaKeygen(
          false,
          this.relayUrl,
          qrParams.sessionId,
          localPartyId,
          allDevices,
          qrParams.hexEncryptionKey,
          { timeoutMs: 30000 }
        )

        mldsaResult = await mldsaKeygen.startKeygenWithRetry()
      } catch (error) {
        console.warn(
          'ML-DSA keygen failed (non-fatal):',
          error instanceof Error ? error.message : error
        )
      }

      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }

      if (qrParams.chains && qrParams.chains.length > 0) {
        reportProgress({
          step: 'keygen',
          progress: 75,
          message: 'Importing chain-specific keys...',
        })

        const chainPrivateKeys = await this.keyDeriver.deriveChainPrivateKeys(
          mnemonic!,
          qrParams.chains as Chain[]
        )

        for (let i = 0; i < chainPrivateKeys.length; i++) {
          if (signal?.aborted) {
            throw new Error('Operation aborted')
          }

          const { chain, privateKeyHex, isEddsa } = chainPrivateKeys[i]

          reportProgress({
            step: 'keygen',
            progress: 75 + Math.floor((i / chainPrivateKeys.length) * 15),
            message: `Importing ${chain} key (${i + 1}/${chainPrivateKeys.length})...`,
            chainId: chain,
          })

          if (isEddsa) {
            const chainSchnorr = new Schnorr(
              { keyimport: true },
              false,
              this.relayUrl,
              qrParams.sessionId,
              localPartyId,
              allDevices,
              [],
              qrParams.hexEncryptionKey,
              new Uint8Array()
            )
            const chainResult = await chainSchnorr.startKeyImportWithRetry(
              privateKeyHex,
              eddsaResult.chaincode,
              chain
            )
            chainPublicKeys[chain] = chainResult.publicKey
            chainKeyShares[chain] = chainResult.keyshare
          } else {
            const chainDkls = new DKLS(
              { keyimport: true },
              false,
              this.relayUrl,
              qrParams.sessionId,
              localPartyId,
              allDevices,
              [],
              qrParams.hexEncryptionKey
            )
            const chainResult = await chainDkls.startKeyImportWithRetry(
              privateKeyHex,
              ecdsaResult.chaincode,
              chain
            )
            chainPublicKeys[chain] = chainResult.publicKey
            chainKeyShares[chain] = chainResult.keyshare
          }
        }
      }
    }

    // Step 9: Signal completion
    reportProgress({
      step: 'keygen',
      progress: 95,
      message: 'Finalizing key import...',
    })

    await setKeygenComplete({
      serverURL: this.relayUrl,
      sessionId: qrParams.sessionId,
      localPartyId,
    })

    const peers = allDevices.filter(d => d !== localPartyId)
    const { error: peerCompleteError } = await attempt(
      waitForKeygenComplete({
        serverURL: this.relayUrl,
        sessionId: qrParams.sessionId,
        peers,
      })
    )
    if (peerCompleteError) {
      console.warn('Not all peer completion signals received, proceeding with valid MPC keys')
    }

    // Step 10: Build vault structure
    const vault: CoreVault = {
      name: qrParams.vaultName,
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
      publicKeyMldsa: mldsaResult?.publicKey,
      keyShareMldsa: mldsaResult?.keyshare,
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
    }
  }
}
