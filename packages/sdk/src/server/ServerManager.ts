import type { WalletCore } from '@trustwallet/wallet-core'
import { generateLocalPartyId } from '@vultisig/core-mpc/devices/localPartyId'
import { DKLS } from '@vultisig/core-mpc/dkls/dkls'
import { batchReshareWithServer } from '@vultisig/core-mpc/fast/api/batchReshareWithServer'
import { createVaultWithServer } from '@vultisig/core-mpc/fast/api/createVaultWithServer'
import { getVaultFromServer, type VaultFromServerResponse } from '@vultisig/core-mpc/fast/api/getVaultFromServer'
import { mldsaWithServer } from '@vultisig/core-mpc/fast/api/mldsaWithServer'
import { resendVaultShare } from '@vultisig/core-mpc/fast/api/resendVaultShare'
import { reshareWithServer } from '@vultisig/core-mpc/fast/api/reshareWithServer'
import { setupVaultWithServer } from '@vultisig/core-mpc/fast/api/setupVaultWithServer'
import { signWithServer } from '@vultisig/core-mpc/fast/api/signWithServer'
import { verifyVaultEmailCode } from '@vultisig/core-mpc/fast/api/verifyVaultEmailCode'
import { setKeygenComplete, waitForKeygenComplete } from '@vultisig/core-mpc/keygenComplete'
import { keysign } from '@vultisig/core-mpc/keysign'
import type { KeysignSignature } from '@vultisig/core-mpc/keysign/KeysignSignature'
import { MldsaKeygen } from '@vultisig/core-mpc/mldsa/mldsaKeygen'
import { MldsaKeysign } from '@vultisig/core-mpc/mldsa/mldsaKeysign'
import { Schnorr } from '@vultisig/core-mpc/schnorr/schnorrKeygen'
import { joinMpcSession } from '@vultisig/core-mpc/session/joinMpcSession'
import { startMpcSession } from '@vultisig/core-mpc/session/startMpcSession'
import { generateHexChainCode } from '@vultisig/core-mpc/utils/generateHexChainCode'
import { generateHexEncryptionKey } from '@vultisig/core-mpc/utils/generateHexEncryptionKey'
import { Vault as CoreVault } from '@vultisig/core-mpc/vault/Vault'
import { without } from '@vultisig/lib-utils/array/without'
import { withoutDuplicates } from '@vultisig/lib-utils/array/withoutDuplicates'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { getHexEncodedRandomBytes } from '@vultisig/lib-utils/crypto/getHexEncodedRandomBytes'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { formatMldsaSignature, formatSignature } from '../adapters/formatSignature'
import { getChainSigningInfo } from '../adapters/getChainSigningInfo'
import { randomUUID } from '../crypto'
import { KeygenProgressUpdate, ReshareOptions, ServerStatus, Signature, SigningPayload } from '../types'
import { TSS_BATCH_MESSAGE_IDS } from '../utils/tssBatching'

/**
 * Server endpoint configuration
 */
export type ServerEndpoints = {
  fastVault?: string
  messageRelay?: string
  notification?: string
}

/**
 * ServerManager coordinates all server communications
 * Uses core functions directly without wrapper classes
 */
export class ServerManager {
  private config: {
    fastVault: string
    messageRelay: string
  }

  constructor(endpoints?: ServerEndpoints) {
    this.config = {
      fastVault: endpoints?.fastVault || 'https://api.vultisig.com/vault',
      messageRelay: endpoints?.messageRelay || 'https://api.vultisig.com/router',
    }
  }

  /** Message relay base URL (MPC keygen / key import coordination). */
  get messageRelay(): string {
    return this.config.messageRelay
  }

  /** FastVault API base URL. */
  get fastVault(): string {
    return this.config.fastVault
  }

  /**
   * Verify vault with email verification code
   */
  async verifyVault(vaultId: string, code: string): Promise<boolean> {
    try {
      await verifyVaultEmailCode({ vaultId, code, vaultBaseUrl: this.config.fastVault })
      return true
    } catch {
      return false
    }
  }

  /**
   * Resend vault verification email
   * Uses POST /vault/resend with public_key_ecdsa, email, password
   */
  async resendVaultVerification(options: { vaultId: string; email: string; password: string }): Promise<void> {
    await resendVaultShare({
      public_key_ecdsa: options.vaultId,
      email: options.email,
      password: options.password,
    })
  }

  /**
   * Fetch FastVault public metadata after the server validates the backup password.
   *
   * Matches `GET /vault/get/{public_key_ecdsa}`: name, public keys, chain code, and the
   * server party id. Key shares are not returned; keep a local backup for signing.
   */
  async getVaultFromServer(vaultId: string, password: string): Promise<VaultFromServerResponse> {
    return getVaultFromServer({
      vaultId,
      password,
      vaultBaseUrl: this.config.fastVault,
    })
  }

  /**
   * Coordinate fast signing with VultiServer
   * Pure server coordination - uses SDK adapters for chain-specific logic
   *
   * @param options.vault Vault with keys and signers
   * @param options.messages Pre-computed message hashes
   * @param options.password Vault password for encryption
   * @param options.payload Original signing payload
   * @param options.walletCore WalletCore instance
   * @param options.onProgress Optional callback for signing progress updates
   * @returns Formatted signature
   */
  async coordinateFastSigning(options: {
    vault: CoreVault
    messages: string[]
    password: string
    payload: SigningPayload
    walletCore: WalletCore
    signal?: AbortSignal
    onProgress?: (step: import('../types').SigningStep) => void
  }): Promise<Signature> {
    const { vault, messages, password, payload, walletCore, signal, onProgress } = options
    const reportProgress = (step: import('../types').SigningStep) => {
      // Check for abort via signal
      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }
      onProgress?.(step)
    }

    // Use SDK adapter to extract chain-specific signing information
    const {
      signatureAlgorithm,
      derivePath: rawDerivePath,
      chainPath: rawChainPath,
    } = getChainSigningInfo(payload, walletCore)

    // Key import vaults store chain-specific keyshares; derive path must be 'm'
    const hasChainKeyShare = !!vault.chainKeyShares?.[payload.chain]
    const derivePath = hasChainKeyShare ? 'm' : rawDerivePath
    const chainPath = hasChainKeyShare ? 'm' : rawChainPath

    // Generate session parameters
    const sessionId = randomUUID()
    const hexEncryptionKey = getHexEncodedRandomBytes(32)
    const signingLocalPartyId = vault.localPartyId || generateLocalPartyId('sdk')

    console.log(`🔑 Generated signing party ID: ${signingLocalPartyId}`)
    console.log(`📡 Calling FastVault API with session ID: ${sessionId}`)

    // Step 1: Coordinating - Call FastVault API
    reportProgress({
      step: 'coordinating',
      progress: 30,
      message: 'Connecting to VultiServer...',
      mode: 'fast' as import('../types').SigningMode,
      participantCount: 2,
      participantsReady: 1,
    })

    shouldBePresent(payload.chain, 'payload.chain')

    if (signatureAlgorithm === 'mldsa') {
      if (!vault.keyShareMldsa) {
        throw new Error('No MLDSA key share found in vault (required for QBTC and other MLDSA chains)')
      }

      reportProgress({
        step: 'coordinating',
        progress: 30,
        message: 'Connecting for ML-DSA signing...',
        mode: 'fast' as import('../types').SigningMode,
        participantCount: 2,
        participantsReady: 1,
      })

      const mldsaHex = await this.runMldsaFastSigningSession({
        vault,
        messages,
        password,
        chain: payload.chain,
        signingLocalPartyId,
        signal,
      })

      if (!mldsaHex) {
        throw new Error('MLDSA signing failed')
      }

      reportProgress({
        step: 'complete',
        progress: 100,
        message: 'Signature complete',
        mode: 'fast' as import('../types').SigningMode,
        participantCount: 2,
        participantsReady: 2,
      })

      return formatMldsaSignature(mldsaHex)
    }

    // Register at relay BEFORE calling FastVault server
    // (must be registered so server can find us when it joins)
    // This matches the extension's flow order in fastVaultKeysign.ts
    await joinMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      localPartyId: signingLocalPartyId,
    })

    await signWithServer({
      public_key: vault.publicKeys.ecdsa,
      messages,
      session: sessionId,
      hex_encryption_key: hexEncryptionKey,
      derive_path: derivePath,
      is_ecdsa: signatureAlgorithm === 'ecdsa',
      vault_password: password,
      chain: payload.chain,
      vaultBaseUrl: this.config.fastVault,
    })
    console.log(`✅ Server acknowledged session: ${sessionId}`)

    // Step 3: Wait for server to ACTUALLY join
    console.log('⏳ Waiting for server to join session...')
    reportProgress({
      step: 'coordinating',
      progress: 50,
      message: 'Waiting for all participants...',
      mode: 'fast' as import('../types').SigningMode,
      participantCount: 2,
      participantsReady: 1,
    })

    const devices = await this.waitForPeers(sessionId, signingLocalPartyId, signal, onProgress)
    const peers = devices.filter(device => device !== signingLocalPartyId)
    console.log(`✅ All participants ready: [${devices.join(', ')}]`)

    reportProgress({
      step: 'coordinating',
      progress: 60,
      message: 'All participants ready, starting MPC session...',
      mode: 'fast' as import('../types').SigningMode,
      participantCount: 2,
      participantsReady: 2,
    })

    // Step 4: Start MPC session
    console.log('📡 Starting MPC session with devices list...')
    await startMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      devices,
    })
    console.log('✅ MPC session started')

    // Step 5: Signing - Perform MPC keysign
    console.log('🔐 Starting MPC keysign process...')
    reportProgress({
      step: 'signing',
      progress: 70,
      message: 'Performing cryptographic signing...',
      mode: 'fast' as import('../types').SigningMode,
      participantCount: 2,
      participantsReady: 2,
    })

    const chainKeyShare = vault.chainKeyShares?.[payload.chain]
    const keyShare = chainKeyShare ?? vault.keyShares[signatureAlgorithm]
    if (!keyShare) {
      throw new Error(`No key share found for algorithm: ${signatureAlgorithm}`)
    }

    // Sign all messages (UTXO can have multiple, EVM typically has one)
    const signatureResults: Record<string, KeysignSignature> = {}
    for (const msg of messages) {
      console.log(`🔏 Signing message: ${msg}`)
      const sig = await keysign({
        keyShare,
        signatureAlgorithm,
        message: msg,
        chainPath, // Use normalized chainPath from adapter
        localPartyId: signingLocalPartyId,
        peers,
        serverUrl: this.config.messageRelay,
        sessionId,
        hexEncryptionKey,
        isInitiatingDevice: true,
      })
      console.log(`✅ Signature obtained for message`)
      signatureResults[msg] = sig
    }

    let mldsaSignatureHex: string | undefined
    if (vault.keyShareMldsa) {
      reportProgress({
        step: 'signing',
        progress: 80,
        message: 'Performing ML-DSA post-quantum signing...',
        mode: 'fast' as import('../types').SigningMode,
        participantCount: 2,
        participantsReady: 2,
      })

      mldsaSignatureHex = await this.runMldsaFastSigningSession({
        vault,
        messages,
        password,
        chain: payload.chain,
        signingLocalPartyId,
        signal,
      })
    }

    // Step 7: Complete - Format signature results
    console.log(`🔄 Formatting signature results...`)
    reportProgress({
      step: 'complete',
      progress: 90,
      message: 'Formatting signature...',
      mode: 'fast' as import('../types').SigningMode,
      participantCount: 2,
      participantsReady: 2,
    })

    const signature = formatSignature(signatureResults, messages, signatureAlgorithm)
    if (mldsaSignatureHex) {
      signature.mldsaSignature = mldsaSignatureHex
    }

    reportProgress({
      step: 'complete',
      progress: 100,
      message: 'Signature complete',
      mode: 'fast' as import('../types').SigningMode,
      participantCount: 2,
      participantsReady: 2,
    })

    return signature
  }

  /**
   * Reshare vault participants
   */
  async reshareVault(
    vault: CoreVault,
    reshareOptions: ReshareOptions & {
      password: string
      email?: string
      tssBatching?: boolean
    }
  ): Promise<CoreVault> {
    if (reshareOptions.tssBatching) {
      await batchReshareWithServer({
        name: vault.name,
        session_id: randomUUID(),
        public_key: vault.publicKeys.ecdsa,
        hex_encryption_key: vault.hexChainCode,
        hex_chain_code: vault.hexChainCode,
        local_party_id: vault.localPartyId,
        old_parties: vault.signers,
        old_reshare_prefix: vault.resharePrefix || '',
        encryption_password: reshareOptions.password,
        email: reshareOptions.email,
        reshare_type: 1,
        lib_type: 1,
        protocols: ['ecdsa', 'eddsa'],
        vaultBaseUrl: this.config.fastVault,
      })
    } else {
      await reshareWithServer({
        name: vault.name,
        session_id: randomUUID(),
        public_key: vault.publicKeys.ecdsa,
        hex_encryption_key: vault.hexChainCode,
        hex_chain_code: vault.hexChainCode,
        local_party_id: vault.localPartyId,
        old_parties: vault.signers,
        old_reshare_prefix: vault.resharePrefix || '',
        encryption_password: reshareOptions.password,
        email: reshareOptions.email,
        reshare_type: 1,
        lib_type: 1,
        vaultBaseUrl: this.config.fastVault,
      })
    }

    return vault
  }

  /**
   * Create a Fast Vault
   */
  async createFastVault(options: {
    name: string
    email: string
    password: string
    signal?: AbortSignal
    onLog?: (msg: string) => void
    onProgress?: (u: KeygenProgressUpdate) => void
    tssBatching?: boolean
  }): Promise<{
    vault: CoreVault
    vaultId: string
    verificationRequired: boolean
  }> {
    // Generate session parameters using core MPC utilities
    const sessionId = randomUUID()
    const hexEncryptionKey = generateHexEncryptionKey()
    const hexChainCode = generateHexChainCode()
    const localPartyId = generateLocalPartyId('sdk')

    const log = options.onLog || (() => {})
    const progress = (update: KeygenProgressUpdate) => {
      if (options.signal?.aborted) {
        throw new Error('Operation aborted')
      }
      options.onProgress?.(update)
    }

    log('Creating vault on FastVault server...')

    // The server party ID should be consistent throughout the process
    const serverPartyId = generateLocalPartyId('server')

    if (options.tssBatching) {
      await setupVaultWithServer({
        name: options.name,
        session_id: sessionId,
        hex_encryption_key: hexEncryptionKey,
        hex_chain_code: hexChainCode,
        local_party_id: serverPartyId,
        encryption_password: options.password,
        email: options.email,
        protocols: ['ecdsa', 'eddsa'],
        vaultBaseUrl: this.config.fastVault,
      })
    } else {
      await createVaultWithServer({
        name: options.name,
        session_id: sessionId,
        hex_encryption_key: hexEncryptionKey,
        hex_chain_code: hexChainCode,
        local_party_id: serverPartyId,
        encryption_password: options.password,
        email: options.email,
        lib_type: 1,
        vaultBaseUrl: this.config.fastVault,
      })
    }

    log('Joining relay session...')

    await joinMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      localPartyId,
    })

    log('Waiting for server and starting MPC session...')

    const devices = await this.waitForPeers(sessionId, localPartyId, options.signal)

    await startMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      devices,
    })

    const dkls = new DKLS(
      { create: true },
      true,
      this.config.messageRelay,
      sessionId,
      localPartyId,
      devices,
      [],
      hexEncryptionKey
    )

    let ecdsaResult: { publicKey: string; keyshare: string; chaincode: string }
    let eddsaResult: { publicKey: string; keyshare: string; chaincode: string }

    if (options.tssBatching) {
      progress({
        phase: 'ecdsa',
        message: 'Generating ECDSA and EdDSA keys...',
      })

      await dkls.prepareKeygenSetup()
      const batchSchnorr = new Schnorr(
        { create: true },
        true,
        this.config.messageRelay,
        sessionId,
        localPartyId,
        devices,
        [],
        hexEncryptionKey,
        dkls.getSetupMessage()
      )

      ;[ecdsaResult, eddsaResult] = await Promise.all([
        dkls.startKeygenWithRetry(TSS_BATCH_MESSAGE_IDS.ecdsa),
        batchSchnorr.startKeygenWithRetry(TSS_BATCH_MESSAGE_IDS.eddsa),
      ])
      log('ECDSA keygen completed successfully')
      log('EdDSA keygen completed successfully')
    } else {
      progress({ phase: 'ecdsa', message: 'Generating ECDSA keys...' })
      ecdsaResult = await dkls.startKeygenWithRetry()
      log('ECDSA keygen completed successfully')

      if (options.signal?.aborted) {
        throw new Error('Operation aborted')
      }

      progress({ phase: 'eddsa', message: 'Generating EdDSA keys...' })
      const schnorr = new Schnorr(
        { create: true },
        true,
        this.config.messageRelay,
        sessionId,
        localPartyId,
        devices,
        [],
        hexEncryptionKey,
        dkls.getSetupMessage()
      )
      eddsaResult = await schnorr.startKeygenWithRetry()
      log('EdDSA keygen completed successfully')
    }

    // Check for abort before finalization
    if (options.signal?.aborted) {
      throw new Error('Operation aborted')
    }

    // Signal keygen completion to all participants
    await setKeygenComplete({
      serverURL: this.config.messageRelay,
      sessionId,
      localPartyId,
    })

    // Wait for all participants to complete
    const peers = devices.filter(d => d !== localPartyId)
    await waitForKeygenComplete({
      serverURL: this.config.messageRelay,
      sessionId,
      peers,
    })

    // Create real vault from keygen results
    const vault: CoreVault = {
      name: options.name,
      publicKeys: {
        ecdsa: ecdsaResult.publicKey,
        eddsa: eddsaResult.publicKey,
      },
      localPartyId,
      signers: devices,
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

    progress({ phase: 'complete', message: 'Vault created successfully' })

    return {
      vault,
      vaultId: vault.publicKeys.ecdsa,
      verificationRequired: true,
    }
  }

  /**
   * Run ML-DSA (post-quantum) keygen with VultiServer for an existing fast vault.
   *
   * VultiServer does not add ML-DSA during initial vault creation; call this after the vault
   * backup exists on the server (typically after ECDSA/EdDSA keygen has completed).
   *
   * @see {@link https://github.com/vultisig/vultiserver} `POST /mldsa` — `ProcessCreateMldsa`
   */
  async addPostQuantumKeysToFastVault(options: {
    vault: CoreVault
    email: string
    password: string
    signal?: AbortSignal
    onLog?: (msg: string) => void
    onProgress?: (u: KeygenProgressUpdate) => void
  }): Promise<{ publicKey: string; keyshare: string }> {
    const { vault, email, password, signal } = options
    const log = options.onLog ?? (() => {})
    const progress = options.onProgress ?? (() => {})

    if (vault.publicKeyMldsa || vault.keyShareMldsa) {
      throw new Error('Vault already has ML-DSA keys')
    }

    const sessionId = randomUUID()
    const hexEncryptionKey = generateHexEncryptionKey()
    const localPartyId = vault.localPartyId

    progress({ phase: 'mldsa', message: 'Requesting ML-DSA key from VultiServer...' })
    log('Joining relay for ML-DSA session...')

    await joinMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      localPartyId,
    })

    await mldsaWithServer({
      public_key: vault.publicKeys.ecdsa,
      session_id: sessionId,
      hex_encryption_key: hexEncryptionKey,
      encryption_password: password,
      email,
      vaultBaseUrl: this.config.fastVault,
    })

    const devices = await this.waitForPeers(sessionId, localPartyId, signal)

    await startMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      devices,
    })

    progress({ phase: 'mldsa', message: 'Generating ML-DSA keys...' })

    const mldsaKeygen = new MldsaKeygen(
      true,
      this.config.messageRelay,
      sessionId,
      localPartyId,
      devices,
      hexEncryptionKey,
      { timeoutMs: 120_000 }
    )

    const result = await mldsaKeygen.startKeygenWithRetry()
    log('ML-DSA keygen completed successfully')

    await setKeygenComplete({
      serverURL: this.config.messageRelay,
      sessionId,
      localPartyId,
    })

    const peers = devices.filter(d => d !== localPartyId)
    await waitForKeygenComplete({
      serverURL: this.config.messageRelay,
      sessionId,
      peers,
    })

    return result
  }

  /**
   * Check VultiServer status and connectivity
   */
  async checkServerStatus(): Promise<ServerStatus> {
    const [fastVaultStatus, relayStatus] = await Promise.allSettled([
      this.pingServer(this.config.fastVault, '/'),
      this.pingServer(this.config.messageRelay, '/ping'),
    ])

    return {
      fastVault: {
        online: fastVaultStatus.status === 'fulfilled',
        latency: fastVaultStatus.status === 'fulfilled' ? fastVaultStatus.value : undefined,
      },
      messageRelay: {
        online: relayStatus.status === 'fulfilled',
        latency: relayStatus.status === 'fulfilled' ? relayStatus.value : undefined,
      },
      timestamp: Date.now(),
    }
  }

  // ===== Private Helper Methods =====

  private async runMldsaFastSigningSession(options: {
    vault: CoreVault
    messages: string[]
    password: string
    chain: string
    signingLocalPartyId: string
    signal?: AbortSignal
  }): Promise<string | undefined> {
    const { vault, messages, password, chain, signingLocalPartyId, signal } = options
    const keyShareMldsa = shouldBePresent(vault.keyShareMldsa, 'vault.keyShareMldsa')

    const mldsaMaxAttempts = 10
    for (let attempt = 0; attempt < mldsaMaxAttempts; attempt++) {
      try {
        const mldsaSessionId = randomUUID()
        const mldsaHexEncryptionKey = getHexEncodedRandomBytes(32)

        await joinMpcSession({
          serverUrl: this.config.messageRelay,
          sessionId: mldsaSessionId,
          localPartyId: signingLocalPartyId,
        })

        await signWithServer({
          public_key: vault.publicKeys.ecdsa,
          messages,
          session: mldsaSessionId,
          hex_encryption_key: mldsaHexEncryptionKey,
          derive_path: 'm',
          is_ecdsa: true,
          vault_password: password,
          chain,
          mldsa: true,
          vaultBaseUrl: this.config.fastVault,
        })

        const mldsaDevices = await this.waitForPeers(mldsaSessionId, signingLocalPartyId, signal)

        await startMpcSession({
          serverUrl: this.config.messageRelay,
          sessionId: mldsaSessionId,
          devices: mldsaDevices,
        })

        const mldsaKeysign = new MldsaKeysign({
          keysignCommittee: mldsaDevices,
          serverURL: this.config.messageRelay,
          sessionId: mldsaSessionId,
          localPartyId: signingLocalPartyId,
          messagesToSign: messages,
          keyShareBase64: keyShareMldsa,
          hexEncryptionKey: mldsaHexEncryptionKey,
          chainPath: 'm',
          isInitiatingDevice: true,
        })

        const mldsaResults = await mldsaKeysign.startKeysign()
        if (mldsaResults.length > 0) {
          return mldsaResults[0].signature
        }
      } catch (error) {
        if (attempt === mldsaMaxAttempts - 1) {
          console.warn('MLDSA signing failed after all attempts:', error instanceof Error ? error.message : error)
        }
      }
    }

    return undefined
  }

  private async waitForPeers(
    sessionId: string,
    localPartyId: string,
    signal?: AbortSignal,
    onProgress?: (step: import('../types').SigningStep) => void
  ): Promise<string[]> {
    const maxWaitTime = 30000
    const checkInterval = 2000
    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitTime) {
      // Check for abort via signal
      if (signal?.aborted) {
        throw new Error('Operation aborted')
      }

      try {
        const url = `${this.config.messageRelay}/${sessionId}`
        const allPeers = await queryUrl<string[]>(url)
        const uniquePeers = withoutDuplicates(allPeers)
        const otherPeers = without(uniquePeers, localPartyId)

        // Report progress
        onProgress?.({
          step: 'coordinating',
          progress: 50,
          message: 'Waiting for server...',
          mode: 'fast' as import('../types').SigningMode,
          participantCount: 2,
          participantsReady: uniquePeers.length,
        })

        if (otherPeers.length > 0) {
          return [localPartyId, ...otherPeers]
        }

        await new Promise(resolve => setTimeout(resolve, checkInterval))
      } catch (error) {
        // Re-throw abort errors
        if (error instanceof Error && error.message === 'Operation aborted') {
          throw error
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval))
      }
    }

    throw new Error('Timeout waiting for peers to join session')
  }

  private async pingServer(baseUrl: string, endpoint = '/ping', timeout = 5000): Promise<number> {
    const start = Date.now()

    try {
      await fetch(`${baseUrl}${endpoint}`, {
        method: 'GET',
        signal: AbortSignal.timeout(timeout),
      })
      return Date.now() - start
    } catch (error) {
      throw new Error(`Server ping failed: ${error}`)
    }
  }
}
