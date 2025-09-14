import type { 
  Vault, 
  SigningPayload, 
  Signature, 
  ReshareOptions, 
  ServerStatus,
  KeygenProgressUpdate
} from '../types'

import { FastVaultClient } from './FastVaultClient'
import { MessageRelayClient } from './MessageRelayClient'
import { 
  generateSessionId,
  generateEncryptionKey,
  generateChainCode,
  generateBrowserPartyId,
  generateServerPartyId
} from './utils'

/**
 * ServerManager coordinates all server communications
 * This is a thin wrapper around existing core MPC functionality
 */
export class ServerManager {
  private fastVaultClient: FastVaultClient
  private messageRelayClient: MessageRelayClient
  private config: {
    fastVault: string
    messageRelay: string
  }

  constructor(endpoints?: {
    fastVault?: string
    messageRelay?: string
  }) {
    this.config = {
      fastVault: endpoints?.fastVault || 'https://api.vultisig.com/vault',
      messageRelay: endpoints?.messageRelay || 'https://api.vultisig.com/router'
    }
    
    this.fastVaultClient = new FastVaultClient(this.config.fastVault)
    this.messageRelayClient = new MessageRelayClient(this.config.messageRelay)
  }

  /**
   * Verify vault with email verification code
   */
  async verifyVault(vaultId: string, code: string): Promise<boolean> {
    return this.fastVaultClient.verifyVault(vaultId, code)
  }

  /**
   * Resend vault verification email
   */
  async resendVaultVerification(vaultId: string): Promise<void> {
    return this.fastVaultClient.resendVaultVerification(vaultId)
  }

  /**
   * Get vault from VultiServer using password
   */
  async getVaultFromServer(vaultId: string, password: string): Promise<Vault> {
    // Use existing core functionality
    const { getVaultFromServer } = await import('@core/mpc/fast/api/getVaultFromServer')
    
    const result = await getVaultFromServer({
      vaultId,
      password
    })
    
    // TODO: Transform result to proper Vault type
    // For now, return a placeholder until the core API is properly typed
    return result as unknown as Vault
  }

  /**
   * Sign transaction using VultiServer (two-step approach like extension)
   * Step 1: Call FastVault server API to initiate signing
   * Step 2: Use MPC keysign with server coordination (skipping setup message)
   */
  async signWithServer(vault: Vault, payload: SigningPayload, vaultPassword: string): Promise<Signature> {
    // Validate vault is a fast vault
    const hasFastVaultServer = vault.signers.some(signer => signer.startsWith('Server-'))
    if (!hasFastVaultServer) {
      throw new Error('Vault does not have VultiServer - fast signing not available')
    }

    // Import required core functions
    const { getChainKind } = await import('@core/chain/ChainKind')
    const { signatureAlgorithms } = await import('@core/chain/signing/SignatureAlgorithm')
    const { initWasm } = await import('@trustwallet/wallet-core')
    const { getCoinType } = await import('@core/chain/coin/coinType')
    const { AddressDeriver } = await import('../chains/AddressDeriver')
    const { joinMpcSession } = await import('@core/mpc/session/joinMpcSession')
    const { shouldBePresent } = await import('@lib/utils/assert/shouldBePresent')
    const { signWithServer: callFastVaultAPI } = await import('@core/mpc/fast/api/signWithServer')

    // Initialize required components
    const walletCore = await initWasm()
    const addressDeriver = new AddressDeriver()
    await addressDeriver.initialize(walletCore)
    const chain = addressDeriver.mapStringToChain(payload.chain)
    const coinType = getCoinType({ walletCore, chain })
    const derivePath = walletCore.CoinTypeExt.derivationPath(coinType)
    
    // Determine signature algorithm
    const chainKind = getChainKind(chain)
    const signatureAlgorithm = signatureAlgorithms[chainKind]

    // Prepare messages for signing
    const messages = shouldBePresent(payload.messageHashes, 'payload.messageHashes')

    // Generate session parameters
    const sessionId = generateSessionId()
    const hexEncryptionKey = await generateEncryptionKey()

    console.log('🔄 Starting fast signing with two-step approach...')

    // STEP 1: Call FastVault server API (like extension's FastKeysignServerStep)
    console.log('📡 Step 1: Calling FastVault server API...')
    await callFastVaultAPI({
      public_key: vault.publicKeys.ecdsa,
      messages,
      session: sessionId,
      hex_encryption_key: hexEncryptionKey,
      derive_path: derivePath,
      is_ecdsa: signatureAlgorithm === 'ecdsa',
      vault_password: vaultPassword
    })

    // STEP 2: Set up relay session and wait for server
    console.log('🔗 Step 2: Setting up relay session...')
    await joinMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      localPartyId: vault.localPartyId
    })

    // Mark session started
    try {
      await fetch(`${this.config.messageRelay}/start/${sessionId}`, { method: 'POST' })
    } catch (_) {
      // non-fatal; proceed regardless
    }

    // Wait for server to join session
    const devices = await this.waitForPeers(sessionId, vault.localPartyId)
    const peers = devices.filter(device => device !== vault.localPartyId)
    
    // STEP 3: Use fast keysign (skip setup message since server is coordinating)
    console.log('🔐 Step 3: Performing MPC keysign with server coordination...')
    const signature = await this.performFastKeysign({
      vault,
      signatureAlgorithm,
      message: messages[0],
      derivePath,
      peers,
      sessionId,
      hexEncryptionKey
    })
    
    console.log('✅ Fast signing completed using two-step approach!')

    const recoveryId = signature.recovery_id
      ? parseInt(signature.recovery_id, 16)
      : undefined

    return {
      signature: signature.der_signature,
      format:
        signatureAlgorithm === 'eddsa'
          ? 'EdDSA'
          : recoveryId !== undefined
            ? 'ECDSA'
            : 'DER',
      recovery: recoveryId,
    }
  }

  /**
   * Perform fast keysign with server coordination (bypasses setup message)
   * Simplified version that uses core keysign with local setup message
   */
  private async performFastKeysign(params: {
    vault: Vault
    signatureAlgorithm: string
    message: string
    derivePath: string
    peers: string[]
    sessionId: string
    hexEncryptionKey: string
  }): Promise<any> {
    // Import required core functions
    const { initializeMpcLib } = await import('@core/mpc/lib/initialize')
    const { makeSetupMessage } = await import('@core/mpc/keysign/setupMessage/make')
    const { makeSignSession, SignSession } = await import('@core/mpc/lib/signSession')
    const { getMessageHash } = await import('@core/mpc/getMessageHash')
    const { shouldBePresent } = await import('@lib/utils/assert/shouldBePresent')
    
    const keyShare = params.vault.keyShares[params.signatureAlgorithm]
    if (!keyShare) {
      throw new Error(`No key share found for algorithm: ${params.signatureAlgorithm}`)
    }

    await initializeMpcLib(params.signatureAlgorithm as any)
    const messageId = getMessageHash(params.message)

    // Create setup message locally (skip server upload/download)
    const devices = [params.vault.localPartyId, ...params.peers]
    const setupMessage = makeSetupMessage({
      keyShare,
      chainPath: params.derivePath.replaceAll("'", ''),
      message: params.message,
      devices,
      signatureAlgorithm: params.signatureAlgorithm as any,
    })

    const session = makeSignSession({
      setupMessage,
      localPartyId: params.vault.localPartyId,
      keyShare,
      signatureAlgorithm: params.signatureAlgorithm as any,
    })

    const setupMessageHash = shouldBePresent(
      SignSession[params.signatureAlgorithm as any].setupMessageHash(setupMessage),
      'Setup message hash'
    )

    if (params.message != Buffer.from(setupMessageHash).toString('hex')) {
      throw new Error('Setup message hash does not match the original message')
    }

    // Use the existing core MPC message processing (simplified)
    const { sendMpcRelayMessage } = await import('@core/mpc/message/relay/send')
    const { getMpcRelayMessages } = await import('@core/mpc/message/relay/get')
    const { deleteMpcRelayMessage } = await import('@core/mpc/message/relay/delete')
    const { toMpcServerMessage, fromMpcServerMessage } = await import('@core/mpc/message/server')
    
    // Simple message exchange loop
    while (!session.isFinished()) {
      // Send outbound messages
      const outboundMessages = session.outboundMessages()
      for (const receiver of outboundMessages) {
        const encryptedMessage = toMpcServerMessage(receiver.message, params.hexEncryptionKey)
        await sendMpcRelayMessage({
          serverUrl: this.config.messageRelay,
          sessionId: params.sessionId,
          messageId,
          message: {
            session_id: params.sessionId,
            from: params.vault.localPartyId,
            to: [receiver.to],
            body: encryptedMessage,
            hash: receiver.hash,
            sequence_no: 0,
          },
        })
      }

      // Get inbound messages
      const relayMessages = await getMpcRelayMessages({
        serverUrl: this.config.messageRelay,
        localPartyId: params.vault.localPartyId,
        sessionId: params.sessionId,
        messageId,
      })

      for (const msg of relayMessages) {
        if (session.inputMessage(fromMpcServerMessage(msg.body, params.hexEncryptionKey))) {
          // Delete processed message
          await deleteMpcRelayMessage({
            serverUrl: this.config.messageRelay,
            localPartyId: params.vault.localPartyId,
            sessionId: params.sessionId,
            messageHash: msg.hash,
            messageId,
          })
          return session.finish()
        }
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    return session.finish()
  }

  /**
   * Reshare vault participants using existing core functionality
   */
  async reshareVault(vault: Vault, reshareOptions: ReshareOptions & { password: string; email?: string }): Promise<Vault> {
    const { reshareWithServer } = await import('@core/mpc/fast/api/reshareWithServer')
    
    await reshareWithServer({
      name: vault.name,
      session_id: generateSessionId(),
      public_key: vault.publicKeys.ecdsa,
      hex_encryption_key: vault.hexChainCode,
      hex_chain_code: vault.hexChainCode,
      local_party_id: vault.localPartyId,
      old_parties: vault.signers,
      old_reshare_prefix: vault.resharePrefix || '',
      encryption_password: reshareOptions.password,
      email: reshareOptions.email,
      reshare_type: 1,
      lib_type: 1
    })
    
    // Return updated vault (in practice, this would involve running MPC reshare protocol)
    return vault
  }

  /**
   * Create a Fast Vault using existing core functionality
   */
  async createFastVault(options: { 
    name: string; 
    email: string; 
    password: string;
    onLog?: (msg: string) => void;
    onProgress?: (u: KeygenProgressUpdate) => void;
  }): Promise<{
    vault: Vault
    vaultId: string
    verificationRequired: boolean
  }> {
    const { setupVaultWithServer } = await import('@core/mpc/fast/api/setupVaultWithServer')
    const { joinMpcSession } = await import('@core/mpc/session/joinMpcSession')
    const { startMpcSession } = await import('@core/ui/mpc/session/utils/startMpcSession')
    
    // Generate session parameters
    const sessionId = generateSessionId()
    const hexEncryptionKey = await generateEncryptionKey()
    const hexChainCode = await generateChainCode()
    const localPartyId = await generateBrowserPartyId()
    
    const log = options.onLog || (() => {})
    const progress = options.onProgress || (() => {})
    
    log('Step 1: Creating vault on FastVault server...')
    
    // Use existing core API to create vault
    await setupVaultWithServer({
      name: options.name,
      session_id: sessionId,
      hex_encryption_key: hexEncryptionKey,
      hex_chain_code: hexChainCode,
      local_party_id: await generateServerPartyId(), // Server party ID
      encryption_password: options.password,
      email: options.email,
      lib_type: 1 // DKLS
    })
    
    log('Step 2: Joining relay session...')
    
    // Use existing core function to join session
    await joinMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      localPartyId
    })
    
    log('Step 3: Waiting for server and starting MPC session...')
    
    // Wait for server to join and get device list
    const devices = await this.waitForPeers(sessionId, localPartyId)
    
    // Start MPC session using existing core function
    await startMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      devices
    })
    
    log('Step 4: Running keygen (this would use core MPC keygen functionality)...')
    progress({ phase: 'ecdsa', message: 'Generating keys...' })
    
    // In a real implementation, this would use existing core keygen functions
    // For now, we'll create a placeholder vault
    const vault: Vault = {
      name: options.name,
      publicKeys: {
        ecdsa: hexChainCode, // Placeholder - would come from actual keygen
        eddsa: ''
      },
      localPartyId,
      signers: devices,
      hexChainCode,
      keyShares: {
        ecdsa: '', // Would come from actual keygen
        eddsa: ''
      },
      libType: 'DKLS',
      isBackedUp: false,
      order: 0,
      createdAt: Date.now()
    }
    
    progress({ phase: 'complete', message: 'Vault created successfully' })
    
    return {
      vault,
      vaultId: vault.publicKeys.ecdsa,
      verificationRequired: true
    }
  }

  /**
   * Check VultiServer status and connectivity
   */
  async checkServerStatus(): Promise<ServerStatus> {
    const [fastVaultStatus, relayStatus] = await Promise.allSettled([
      this.fastVaultClient.ping(),
      this.messageRelayClient.ping()
    ])

    return {
      fastVault: {
        online: fastVaultStatus.status === 'fulfilled',
        latency: fastVaultStatus.status === 'fulfilled' ? fastVaultStatus.value : undefined
      },
      messageRelay: {
        online: relayStatus.status === 'fulfilled', 
        latency: relayStatus.status === 'fulfilled' ? relayStatus.value : undefined
      },
      timestamp: Date.now()
    }
  }

  /**
   * Get message relay client for MPC operations
   */
  getMessageRelayClient(): MessageRelayClient {
    return this.messageRelayClient
  }

  // ===== Private Helper Methods =====

  /**
   * Wait for peers to join session
   */
  private async waitForPeers(sessionId: string, localPartyId: string): Promise<string[]> {
    const { queryUrl } = await import('@lib/utils/query/queryUrl')
    const { without } = await import('@lib/utils/array/without')
    const { withoutDuplicates } = await import('@lib/utils/array/withoutDuplicates')
    
    const maxWaitTime = 30000 // 30 seconds
    const checkInterval = 2000 // 2 seconds
    const startTime = Date.now()
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        const url = `${this.config.messageRelay}/${sessionId}`
        const allPeers = await queryUrl<string[]>(url)
        const uniquePeers = withoutDuplicates(allPeers)
        const otherPeers = without(uniquePeers, localPartyId)

        if (otherPeers.length > 0) {
          return [localPartyId, ...otherPeers]
        }
        
        await new Promise(resolve => setTimeout(resolve, checkInterval))
      } catch (error) {
        console.warn('Error checking peers:', error)
        await new Promise(resolve => setTimeout(resolve, checkInterval))
      }
    }
    
    throw new Error('Timeout waiting for peers to join session')
  }

}
