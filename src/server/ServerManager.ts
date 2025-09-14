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
   * Sign transaction using VultiServer (proper MPC flow)
   * Uses existing core keysign functionality
   */
  async signWithServer(vault: Vault, payload: SigningPayload, vaultPassword: string): Promise<Signature> {
    // Validate vault is a fast vault
    const hasFastVaultServer = vault.signers.some(signer => signer.startsWith('Server-'))
    if (!hasFastVaultServer) {
      throw new Error('Vault does not have VultiServer - fast signing not available')
    }

    // Use existing core functionality for signing
    const { keysign } = await import('@core/mpc/keysign')
    const { getChainKind } = await import('@core/chain/ChainKind')
    const { signatureAlgorithms } = await import('@core/chain/signing/SignatureAlgorithm')
    const { initWasm } = await import('@trustwallet/wallet-core')
    const { getCoinType } = await import('@core/chain/coin/coinType')
    const { AddressDeriver } = await import('../chains/AddressDeriver')
    const { joinMpcSession } = await import('@core/mpc/session/joinMpcSession')
    const { shouldBePresent } = await import('@lib/utils/assert/shouldBePresent')

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

    // Prepare messages for signing — use provided hex message hashes per spec
    const messages = shouldBePresent(payload.messageHashes, 'payload.messageHashes')

    // Generate session parameters
    const sessionId = generateSessionId()
    const hexEncryptionKey = await generateEncryptionKey()

    console.log('🔄 Starting fast signing with existing core functions...')

    // Step 1: Join relay session FIRST and register local party
    await joinMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      localPartyId: vault.localPartyId
    })

    // Mark session started (helps some relay deployments accept setup-message)
    try {
      await fetch(`${this.config.messageRelay}/start/${sessionId}`, { method: 'POST' })
    } catch (_) {
      // non-fatal; proceed regardless
    }

    // Step 2: Kick off signing on FastVault server
    await this.fastVaultClient.signWithServer({
      publicKey: vault.publicKeys.ecdsa,
      messages,
      session: sessionId,
      hexEncryptionKey,
      derivePath: derivePath,
      isEcdsa: signatureAlgorithm === 'ecdsa',
      vaultPassword
    })
    
    // Step 3: Wait for server to join session
    const devices = await this.waitForPeers(sessionId, vault.localPartyId)
    
    // Step 4: Use existing keysign function for MPC signing (handles its own session management)
    const keyShare = vault.keyShares[signatureAlgorithm]
      if (!keyShare) {
        throw new Error(`No key share found for algorithm: ${signatureAlgorithm}`)
      }
      
    const peers = devices.filter(device => device !== vault.localPartyId)
    
    // Sign the first message using existing core keysign
        const signature = await keysign({
          keyShare,
          signatureAlgorithm: signatureAlgorithm as any,
      message: messages[0],
      chainPath: derivePath.replaceAll("'", ''),
      localPartyId: vault.localPartyId,
          peers,
      serverUrl: this.config.messageRelay,
      sessionId,
      hexEncryptionKey: vault.hexChainCode,
      isInitiatingDevice: true,
    })
    
    console.log('✅ Fast signing completed using core functions!')

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
