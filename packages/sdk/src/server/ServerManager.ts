import { generateLocalPartyId } from '@core/mpc/devices/localPartyId'
import { DKLS } from '@core/mpc/dkls/dkls'
import { getVaultFromServer } from '@core/mpc/fast/api/getVaultFromServer'
import { resendVaultShare } from '@core/mpc/fast/api/resendVaultShare'
import { reshareWithServer } from '@core/mpc/fast/api/reshareWithServer'
import { setupVaultWithServer } from '@core/mpc/fast/api/setupVaultWithServer'
import { signWithServer } from '@core/mpc/fast/api/signWithServer'
import { verifyVaultEmailCode } from '@core/mpc/fast/api/verifyVaultEmailCode'
import { setKeygenComplete, waitForKeygenComplete } from '@core/mpc/keygenComplete'
import { keysign } from '@core/mpc/keysign'
import type { KeysignSignature } from '@core/mpc/keysign/KeysignSignature'
import { Schnorr } from '@core/mpc/schnorr/schnorrKeygen'
import { joinMpcSession } from '@core/mpc/session/joinMpcSession'
import { startMpcSession } from '@core/mpc/session/startMpcSession'
import { generateHexChainCode } from '@core/mpc/utils/generateHexChainCode'
import { generateHexEncryptionKey } from '@core/mpc/utils/generateHexEncryptionKey'
import { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { without } from '@lib/utils/array/without'
import { withoutDuplicates } from '@lib/utils/array/withoutDuplicates'
import { getHexEncodedRandomBytes } from '@lib/utils/crypto/getHexEncodedRandomBytes'
import { queryUrl } from '@lib/utils/query/queryUrl'
import type { WalletCore } from '@trustwallet/wallet-core'

import { formatSignature } from '../adapters/formatSignature'
import { getChainSigningInfo } from '../adapters/getChainSigningInfo'
import { randomUUID } from '../crypto'
import { KeygenProgressUpdate, ReshareOptions, ServerStatus, Signature, SigningPayload } from '../types'

/**
 * Server endpoint configuration
 */
export type ServerEndpoints = {
  fastVault?: string
  messageRelay?: string
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

  /**
   * Verify vault with email verification code
   */
  async verifyVault(vaultId: string, code: string): Promise<boolean> {
    try {
      await verifyVaultEmailCode({ vaultId, code })
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
   * Get vault from VultiServer using password
   *
   * NOTE: The core getVaultFromServer currently returns minimal data.
   * This needs to be updated to properly retrieve and decrypt the vault data.
   */
  async getVaultFromServer(vaultId: string, password: string): Promise<CoreVault> {
    const result = await getVaultFromServer({ vaultId, password })

    // TODO: Properly convert/decrypt the vault data from server response
    // Currently the core function returns { password } which is incomplete
    return result as unknown as CoreVault
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
    const { signatureAlgorithm, derivePath, chainPath } = getChainSigningInfo(payload, walletCore)

    // Generate session parameters
    const sessionId = randomUUID()
    const hexEncryptionKey = getHexEncodedRandomBytes(32)
    const signingLocalPartyId = generateLocalPartyId('sdk')

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

    const serverResponse = await signWithServer({
      public_key: vault.publicKeys.ecdsa,
      messages,
      session: sessionId,
      hex_encryption_key: hexEncryptionKey,
      derive_path: derivePath,
      is_ecdsa: signatureAlgorithm === 'ecdsa',
      vault_password: password,
    })
    console.log(`✅ Server acknowledged session: ${serverResponse}`)

    // Step 2: Join relay session
    reportProgress({
      step: 'coordinating',
      progress: 40,
      message: 'Joining relay session...',
      mode: 'fast' as import('../types').SigningMode,
      participantCount: 2,
      participantsReady: 1,
    })

    await joinMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      localPartyId: signingLocalPartyId,
    })

    // Step 2.5: Register server as participant
    try {
      const serverSigner = vault.signers.find((signer: string) => signer.startsWith('Server-'))
      if (serverSigner) {
        await queryUrl(`${this.config.messageRelay}/${sessionId}`, {
          body: [serverSigner],
          responseType: 'none',
        })
      }
    } catch {
      // non-fatal
    }

    // Step 3: Wait for server to join
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

    const keyShare = vault.keyShares[signatureAlgorithm]
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

    // Step 6: Complete - Format signature results
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
    reshareOptions: ReshareOptions & { password: string; email?: string }
  ): Promise<CoreVault> {
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
    })

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

    await setupVaultWithServer({
      name: options.name,
      session_id: sessionId,
      hex_encryption_key: hexEncryptionKey,
      hex_chain_code: hexChainCode,
      local_party_id: serverPartyId, // Use server party ID for server communication
      encryption_password: options.password,
      email: options.email,
      lib_type: 1,
    })

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

    // Real MPC keygen - ECDSA first
    progress({ phase: 'ecdsa', message: 'Generating ECDSA keys...' })

    // Create DKLS instance for ECDSA keygen
    const dkls = new DKLS(
      { create: true }, // KeygenOperation - creating new vault
      true, // isInitiateDevice
      this.config.messageRelay,
      sessionId,
      localPartyId, // This should be the browser/client party ID
      devices, // keygenCommittee (includes both browser and server)
      [], // oldKeygenCommittee (empty for new vault)
      hexEncryptionKey
    )

    // Run ECDSA keygen
    const ecdsaResult = await dkls.startKeygenWithRetry()
    log('ECDSA keygen completed successfully')

    // Check for abort before EdDSA keygen
    if (options.signal?.aborted) {
      throw new Error('Operation aborted')
    }

    // EdDSA keygen using the same setup message
    progress({ phase: 'eddsa', message: 'Generating EdDSA keys...' })

    const setupMessage = dkls.getSetupMessage()
    const schnorr = new Schnorr(
      { create: true }, // KeygenOperation
      true, // isInitiateDevice
      this.config.messageRelay,
      sessionId, // Use same session ID as ECDSA
      localPartyId,
      devices, // keygenCommittee
      [], // oldKeygenCommittee
      hexEncryptionKey,
      setupMessage // Reuse setup message from DKLS
    )

    // Run EdDSA keygen
    const eddsaResult = await schnorr.startKeygenWithRetry()
    log('EdDSA keygen completed successfully')

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
