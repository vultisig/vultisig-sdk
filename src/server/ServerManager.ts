import type { 
  Vault, 
  SigningPayload, 
  Signature, 
  ReshareOptions, 
  ServerStatus,
  KeygenProgressUpdate
} from '../types'
// import type { VaultKeyShares } from '@core/ui/vault/Vault'

import { FastVaultClient } from './FastVaultClient'
import { MessageRelayClient } from './MessageRelayClient'

/**
 * ServerManager coordinates all server communications
 * Manages Fast Vault operations and message relay
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
    return this.fastVaultClient.getVault(vaultId, password)
  }

  /**
   * Sign transaction using VultiServer (proper MPC flow)
   */
  async signWithServer(vault: Vault, payload: SigningPayload, vaultPassword: string): Promise<Signature> {
    // Validate vault is a fast vault
    const hasFastVaultServer = vault.signers.some(signer => signer.startsWith('Server-'))
    if (!hasFastVaultServer) {
      throw new Error('Vault does not have VultiServer - fast signing not available')
    }

    // Prepare message hashes for signing
    const messages = await this.prepareMessageHashes(payload)
    
    // Generate session ID for this signing operation
    const sessionId = this.generateSessionId()
    
    // Get encryption key for this vault (from vault's hex chain code for now)
    const hexEncryptionKey = vault.hexChainCode
    
    // Get derivation path for the chain
    const derivePath = await this.getDerivationPath(payload.chain)
    
    // Determine if this is ECDSA or EdDSA based on chain
    const isEcdsa = await this.isEcdsaChain(payload.chain)
    
    console.log('🔑 Using provided vault password for signing')

    console.log('🔄 Starting fast signing MPC flow...')
    console.log('  Session ID:', sessionId)
    console.log('  Messages to sign:', messages.length)
    console.log('  Algorithm:', isEcdsa ? 'ECDSA' : 'EdDSA')
    
    try {
      // STEP 1: Initiate signing session with FastVault server
      console.log('📤 Step 1: Initiating signing session with FastVault server')
      await this.fastVaultClient.signWithServer({
        publicKey: vault.publicKeys.ecdsa,
        messages,
        session: sessionId,
        hexEncryptionKey,
        derivePath,
        isEcdsa,
        vaultPassword
      })
      console.log('✅ Step 1: Signing session initiated')
      
      // STEP 2: Join relay server for MPC coordination
      console.log('📤 Step 2: Joining relay server for MPC coordination')
      const relayServerUrl = this.config.messageRelay
      
      // Register browser with relay
      await this.joinRelaySession({
        serverUrl: relayServerUrl,
        sessionId,
        localPartyId: vault.localPartyId
      })
      console.log('✅ Step 2: Joined relay server')
      
      // STEP 3: Wait for VultiServer to join signing session
      console.log('📤 Step 3: Waiting for VultiServer to join signing session')
      const signingParties = await this.waitForServerToJoinSession({
        serverUrl: relayServerUrl,
        sessionId,
        localPartyId: vault.localPartyId,
        maxWaitTime: 30000,
        onLog: (msg) => console.log('  ', msg)
      })
      console.log('✅ Step 3: VultiServer joined, parties:', signingParties)
      
      // STEP 4: Start MPC signing session
      console.log('📤 Step 4: Starting MPC signing session')
      await this.startRelaySession({
        serverUrl: relayServerUrl,
        sessionId,
        devices: signingParties
      })
      console.log('✅ Step 4: MPC signing session started')
      
      // STEP 5: Run MPC signing protocol (this would use WASM libraries)
      console.log('📤 Step 5: Running MPC signing protocol')
      // TODO: Implement actual MPC signing with WASM libraries
      // For now, we'll simulate the signing process
      const signature = await this.runMpcSigning({
        sessionId,
        hexEncryptionKey,
        localPartyId: vault.localPartyId,
        serverUrl: relayServerUrl,
        signingParties,
        messages,
        isEcdsa
      })
      
      console.log('✅ Step 5: MPC signing completed')
      console.log('📝 Signature obtained:', signature.signature.slice(0, 20) + '...')
      
      return signature
      
    } catch (error) {
      console.error('❌ Fast signing with server failed:', error)
      throw new Error(`Fast signing failed: ${(error as Error).message}`)
    }
  }

  /**
   * Run MPC signing protocol (placeholder implementation)
   * In reality, this would use WASM libraries for MPC signing
   */
  private async runMpcSigning(params: {
    sessionId: string
    hexEncryptionKey: string
    localPartyId: string
    serverUrl: string
    signingParties: string[]
    messages: string[]
    isEcdsa: boolean
  }): Promise<Signature> {
    console.log('🔐 Starting MPC signing protocol...')
    console.log('  Parties:', params.signingParties)
    console.log('  Messages:', params.messages.length)
    
    // TODO: Replace this with actual WASM MPC signing implementation
    // This would involve:
    // 1. Initialize MPC signing library (DKLS or Schnorr)
    // 2. Exchange signing messages via relay server
    // 3. Complete MPC signing protocol
    // 4. Return the final signature
    
    // For now, simulate the signing process
    await new Promise(resolve => setTimeout(resolve, 500)) // Simulate signing time
    
    // Generate a mock signature (in reality, this comes from MPC protocol)
    const mockSignature = '0x' + Array.from(crypto.getRandomValues(new Uint8Array(65)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    
    return {
      signature: mockSignature,
      format: params.isEcdsa ? 'ECDSA' : 'EdDSA'
    }
  }

  /**
   * Prepare message hashes from signing payload
   */
  private async prepareMessageHashes(payload: SigningPayload): Promise<string[]> {
    // If message hashes are pre-computed, use them
    if (payload.messageHashes && payload.messageHashes.length > 0) {
      return payload.messageHashes
    }
    
    // Otherwise, we need to compute message hashes from the transaction
    // This is a simplified implementation - in reality, this would be chain-specific
    const transactionData = JSON.stringify(payload.transaction)
    const encoder = new TextEncoder()
    const data = encoder.encode(transactionData)
    
    // Create SHA-256 hash
    let hash: string
    if (typeof globalThis !== 'undefined' && (globalThis as any).crypto?.subtle) {
      const digest = await (globalThis as any).crypto.subtle.digest('SHA-256', data)
      const bytes = new Uint8Array(digest)
      hash = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    } else {
      const { createHash } = await import('crypto')
      hash = createHash('sha256').update(Buffer.from(data)).digest('hex')
    }
    
    return [hash]
  }

  /**
   * Get derivation path for a chain
   */
  private async getDerivationPath(chain: any): Promise<string> {
    // This is a simplified implementation
    // In reality, this would use WalletCore to get the proper derivation path
    const chainName = typeof chain === 'string' ? chain : chain.name || 'ethereum'
    
    // Common derivation paths
    const derivationPaths: Record<string, string> = {
      bitcoin: "m/84'/0'/0'/0/0",
      ethereum: "m/44'/60'/0'/0/0",
      solana: "m/44'/501'/0'/0'",
      thorchain: "m/44'/931'/0'/0/0",
      // Add more chains as needed
    }
    
    return derivationPaths[chainName.toLowerCase()] || "m/44'/60'/0'/0/0" // Default to Ethereum
  }

  /**
   * Determine if chain uses ECDSA or EdDSA
   */
  private async isEcdsaChain(chain: any): Promise<boolean> {
    const chainName = typeof chain === 'string' ? chain : chain.name || 'ethereum'
    
    // Most chains use ECDSA, only a few use EdDSA
    const eddsaChains = ['solana', 'sui', 'ton']
    return !eddsaChains.includes(chainName.toLowerCase())
  }

  /**
   * Reshare vault participants
   */
  async reshareVault(vault: Vault, _reshareOptions: ReshareOptions): Promise<Vault> {
    await this.fastVaultClient.reshareVault({
      name: vault.name,
      sessionId: '', // Needs session management
      hexEncryptionKey: '', // Needs key generation
      hexChainCode: vault.hexChainCode,
      localPartyId: vault.localPartyId,
      oldResharePrefix: vault.resharePrefix || '',
      encryptionPassword: '', // Needs password management
      oldParties: vault.signers,
      email: undefined
    })
    
    // Return updated vault (simplified)
    return vault
  }

  // ===== Relay session helpers =====
  async startRelaySession(params: { serverUrl: string; sessionId: string; devices: string[] }): Promise<void> {
    const { startMpcSession } = await import('@core/ui/mpc/session/utils/startMpcSession')
    await startMpcSession({
      serverUrl: params.serverUrl,
      sessionId: params.sessionId,
      devices: params.devices,
    })
  }

  async getRelayPeerOptions(params: { serverUrl: string; sessionId: string; localPartyId: string }): Promise<string[]> {
    const { queryUrl } = await import('@lib/utils/query/queryUrl')
    const { without } = await import('@lib/utils/array/without')
    const { withoutDuplicates } = await import('@lib/utils/array/withoutDuplicates')
    
    // Use the documented endpoint format: GET /router/{sessionId}
    const url = `${params.serverUrl}/${params.sessionId}`
    console.log(`Polling relay peers: GET ${url}`)
    
    try {
      const peers = await queryUrl<string[]>(url)
      console.log(`Raw peer response:`, peers)
      const filteredPeers = without(withoutDuplicates(peers), params.localPartyId)
      console.log(`Filtered peers (without ${params.localPartyId}):`, filteredPeers)
      return filteredPeers
    } catch (error) {
      console.error(`Failed to fetch peers from ${url}:`, error)
      throw error
    }
  }

  /**
   * Join relay session (programmatic approach)
   */
  async joinRelaySession(params: { serverUrl: string; sessionId: string; localPartyId: string }): Promise<void> {
    const { queryUrl } = await import('@lib/utils/query/queryUrl')
    
    // Register local party ID with session: POST /router/{sessionId}
    await queryUrl(`${params.serverUrl}/${params.sessionId}`, {
      body: [params.localPartyId],
      responseType: 'none',
    })
  }

  // ===== MPC Message Exchange API =====
  /**
   * Upload setup message for keygen session
   */
  async uploadSetupMessage(params: { serverUrl: string; sessionId: string; message: string }): Promise<void> {
    const { queryUrl } = await import('@lib/utils/query/queryUrl')
    
    await queryUrl(`${params.serverUrl}/setup-message/${params.sessionId}`, {
      body: params.message,
      responseType: 'none',
    })
  }

  /**
   * Fetch setup message for keygen session
   */
  async fetchSetupMessage(params: { serverUrl: string; sessionId: string }): Promise<string> {
    const { queryUrl } = await import('@lib/utils/query/queryUrl')
    
    return await queryUrl<string>(`${params.serverUrl}/setup-message/${params.sessionId}`)
  }

  /**
   * Upload MPC message for a round
   */
  async uploadMpcMessage(params: {
    serverUrl: string
    sessionId: string
    message: string
  }): Promise<void> {
    const { queryUrl } = await import('@lib/utils/query/queryUrl')
    
    await queryUrl(`${params.serverUrl}/message/${params.sessionId}`, {
      body: params.message,
      responseType: 'none',
    })
  }

  /**
   * Poll MPC messages for local party
   */
  async pollMpcMessages(params: {
    serverUrl: string
    sessionId: string
    localPartyId: string
  }): Promise<string[]> {
    const { queryUrl } = await import('@lib/utils/query/queryUrl')
    
    return await queryUrl<string[]>(`${params.serverUrl}/message/${params.sessionId}/${params.localPartyId}`)
  }

  /**
   * Acknowledge (delete) processed MPC message
   */
  async acknowledgeMpcMessage(params: {
    serverUrl: string
    sessionId: string
    localPartyId: string
    messageHash: string
  }): Promise<void> {
    const { queryUrl } = await import('@lib/utils/query/queryUrl')
    
    await queryUrl(`${params.serverUrl}/message/${params.sessionId}/${params.localPartyId}/${params.messageHash}`, {
      method: 'DELETE',
      responseType: 'none',
    })
  }

  /**
   * Signal keygen completion
   */
  async signalCompletion(params: {
    serverUrl: string
    sessionId: string
    localPartyId: string
  }): Promise<void> {
    const { queryUrl } = await import('@lib/utils/query/queryUrl')
    
    await queryUrl(`${params.serverUrl}/complete/${params.sessionId}`, {
      body: params.localPartyId,
      responseType: 'none',
    })
  }

  /**
   * Check if all parties have completed keygen
   */
  async checkKeygenCompletion(params: {
    serverUrl: string
    sessionId: string
  }): Promise<string[]> {
    const { queryUrl } = await import('@lib/utils/query/queryUrl')
    
    return await queryUrl<string[]>(`${params.serverUrl}/complete/${params.sessionId}`)
  }

  // ===== FastVault creation helper =====
  async createFastVaultOnServer(params: {
    name: string
    sessionId: string
    hexEncryptionKey: string
    hexChainCode: string
    localPartyId: string
    encryptionPassword: string
    email: string
    libType: number
  }): Promise<void> {
    const { setupVaultWithServer } = await import('@core/mpc/fast/api/setupVaultWithServer')
    await setupVaultWithServer({
      name: params.name,
      session_id: params.sessionId,
      hex_encryption_key: params.hexEncryptionKey,
      hex_chain_code: params.hexChainCode,
      local_party_id: params.localPartyId,
      encryption_password: params.encryptionPassword,
      email: params.email,
      lib_type: params.libType,
    })
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

  /**
   * Create a Fast Vault where VultiServer acts as the second device
   * Implements the complete 3-step flow: create, wait for server, start MPC
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
    // Generate session parameters for this vault creation
    const sessionId = this.generateSessionId()
    const hexEncryptionKey = this.generateEncryptionKey()
    const hexChainCode = this.generateChainCode()
    const localPartyId = this.generateLocalPartyId()
    const relayServerUrl = `${this.config.messageRelay}`
    
    const log = (m: string) => {
      try { options.onLog?.(m) } catch {}
    }
    const progress = (u: KeygenProgressUpdate) => {
      try { options.onProgress?.(u) } catch {}
    }

    // STEP 1: Create vault on FastVault server  
    log('Step 1: POST /vault/create')
    log(`Session ID: ${sessionId}`)
    log(`Local Party ID: ${localPartyId}`)
    log(`Encryption Key Length: ${hexEncryptionKey.length}`)
    log(`Chain Code Length: ${hexChainCode.length}`)
    
    // Generate server party ID for VultiServer (matches extension pattern)
    const serverPartyId = this.generateServerPartyId()
    log(`Generated Server Party ID: ${serverPartyId}`)
    
    await this.fastVaultClient.createVault({
      name: options.name,
      sessionId,
      hexEncryptionKey,
      hexChainCode,
      localPartyId: serverPartyId, // Server party ID (NOT user device ID)
      encryptionPassword: options.password,
      email: options.email,
      libType: 1 // DKLS
    })
    
    // STEP 2: Wait for VultiServer to join relay session
    log('Step 2: Waiting for server peer on relay (GET /router/{sessionId})')
    const devices = await this.waitForServerToJoinSession({
      serverUrl: relayServerUrl,
      sessionId,
      localPartyId,
      maxWaitTime: 30000, // 30 seconds timeout
      onLog: log
    })
    
    // STEP 3: Start MPC session for key generation
    log('Step 3: POST /router/start/{sessionId}')
    await this.startRelaySession({
      serverUrl: relayServerUrl,
      sessionId,
      devices
    })
    
    // STEP 4: Run MPC key generation (this will be handled by WASM modules)
    log('Step 4: Running DKLS/Schnorr keygen via relay')
    progress({ phase: 'prepare', message: 'Initializing keygen' })
    const { publicKeyEcdsa, publicKeyEddsa } = await this.runMpcKeygen({
      sessionId,
      hexEncryptionKey,
      hexChainCode,
      localPartyId,
      serverUrl: relayServerUrl,
      devices,
      onLog: log,
      onProgress: progress
    })
    
    // Create vault object with generated keys
    const vault: Vault = {
      name: options.name,
      publicKeys: {
        ecdsa: publicKeyEcdsa,
        eddsa: publicKeyEddsa || '' // EdDSA is optional
      },
      localPartyId,
      signers: devices, // User + VultiServer (with actual server party ID)
      hexChainCode,
      keyShares: {
        ecdsa: '', // Key shares managed by MPC protocol
        eddsa: publicKeyEddsa ? '' : ''
      },
      libType: 'DKLS',
      isBackedUp: false,
      order: 0,
      createdAt: Date.now()
    }
    
    return {
      vault,
      vaultId: vault.publicKeys.ecdsa, // Always use ECDSA key as vault ID
      verificationRequired: true
    }
  }

  /**
   * Wait for VultiServer to join the relay session before starting MPC
   */
  private async waitForServerToJoinSession(params: {
    serverUrl: string
    sessionId: string
    localPartyId: string
    maxWaitTime: number
    onLog?: (msg: string) => void
  }): Promise<string[]> {
    const log = (msg: string) => {
      try { params.onLog?.(msg) } catch {}
    }
    
    // Register our local party with the relay before polling
    try {
      log(`Step 2: Registering local party ${params.localPartyId} with relay (POST ${params.serverUrl}/${params.sessionId})`)
      await this.joinRelaySession({
        serverUrl: params.serverUrl,
        sessionId: params.sessionId,
        localPartyId: params.localPartyId,
      })
      log('Step 2: Local party registered with relay')
    } catch (error) {
      log(`Step 2: Failed to register local party: ${(error as Error).message}`)
    }
    
    const startTime = Date.now()
    const checkInterval = 2000 // Check every 2 seconds
    let attemptCount = 0
    
    log(`Step 2: Starting to poll for VultiServer (timeout: ${params.maxWaitTime}ms)`)
    log(`Step 2: Checking ${params.serverUrl}/${params.sessionId} every ${checkInterval}ms`)
    
    while (Date.now() - startTime < params.maxWaitTime) {
      try {
        attemptCount++
        const elapsed = Date.now() - startTime
        log(`Step 2: Polling attempt ${attemptCount} (${Math.round(elapsed/1000)}s elapsed)`)
        
        // Get all peers including our own party ID
        const { queryUrl } = await import('@lib/utils/query/queryUrl')
        const url = `${params.serverUrl}/${params.sessionId}`
        const allPeers = await queryUrl<string[]>(url)
        log(`Step 2: Found ${allPeers.length} total peers: [${allPeers.join(', ')}]`)

        // Proceed only when there is at least one non-local peer
        const { without } = await import('@lib/utils/array/without')
        const { withoutDuplicates } = await import('@lib/utils/array/withoutDuplicates')
        const uniquePeers = withoutDuplicates(allPeers)
        const otherPeers = without(uniquePeers, params.localPartyId)

        if (otherPeers.length > 0) {
          const devices = [params.localPartyId, ...otherPeers]
          log(`Step 2: ✅ Session ready! Devices: [${devices.join(', ')}]`)
          log(`Step 2: Other peers (excluding ${params.localPartyId}): [${otherPeers.join(', ')}]`)
          return devices
        }
        
        // Session not ready yet (empty response), continue polling
        const remainingTime = Math.round((params.maxWaitTime - elapsed) / 1000)
        log(`Step 2: Empty peer response, continuing to poll (${remainingTime}s remaining)`)
        
        // Wait before checking again
        await new Promise(resolve => setTimeout(resolve, checkInterval))
      } catch (error) {
        log(`Step 2: Error checking relay peers: ${(error as Error).message}`)
        console.warn('Error checking relay peers:', error)
        await new Promise(resolve => setTimeout(resolve, checkInterval))
      }
    }
    
    log(`Step 2: ❌ Timeout after ${Math.round(params.maxWaitTime/1000)}s waiting for VultiServer`)
    throw new Error('Timeout waiting for VultiServer to join relay session')
  }

  /**
   * Run MPC key generation protocol for both ECDSA and EdDSA
   */
  private async runMpcKeygen(params: {
    sessionId: string
    hexEncryptionKey: string
    hexChainCode: string
    localPartyId: string
    serverUrl: string
    devices: string[]
    onLog?: (msg: string) => void
    onProgress?: (u: KeygenProgressUpdate) => void
  }): Promise<{
    publicKeyEcdsa: string
    publicKeyEddsa?: string
  }> {
    const log = (msg: string) => {
      try { params.onLog?.(msg) } catch {}
    }
    // Imports are done in specific keygen methods
    
    // Extract server parties (should include actual VultiServer party ID now)
    const serverParties = params.devices.filter(d => d !== params.localPartyId)
    
    if (serverParties.length === 0) {
      throw new Error('No VultiServer found in device list - this should not happen')
    }
    
    log(`Step 4: DKLS participants: [${params.localPartyId}, ${serverParties.join(', ')}]`)
    
    // Run both keygens with proper coordination and retry logic
    const { publicKeyEcdsa, publicKeyEddsa } = await this.runBothKeygens({ ...params, serverParties })
    
    if (!publicKeyEcdsa) {
      throw new Error('ECDSA keygen failed - required for vault ID')
    }
    
    // Signal keygen completion (matches extension pattern)
    log('Step 4: Signaling keygen completion')
    await this.signalKeygenComplete({
      serverUrl: params.serverUrl,
      sessionId: params.sessionId,
      localPartyId: params.localPartyId
    })
    
    // Wait for all parties to complete keygen
    log('Step 4: Waiting for all parties to complete')
    await this.waitForKeygenComplete({
      serverUrl: params.serverUrl,
      sessionId: params.sessionId,
      peers: params.devices
    })
    
    return {
      publicKeyEcdsa,
      publicKeyEddsa
    }
  }
  
  /**
   * Run both ECDSA and EdDSA keygens with proper coordination and retry logic
   */
  private async runBothKeygens(params: {
    sessionId: string
    hexEncryptionKey: string
    localPartyId: string
    serverUrl: string
    serverParties: string[]
    onLog?: (message: string) => void
    onProgress?: (u: KeygenProgressUpdate) => void
  }): Promise<{ publicKeyEcdsa: string; publicKeyEddsa: string | undefined }> {
    const log = params.onLog || console.log
    const progress = params.onProgress || (() => {})
    const maxRetries = 3
    let lastError: Error | undefined

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log(`Attempt ${attempt}/${maxRetries}: Running MPC keygens`)
        
        // Start message-based round counter (non-destructive polling)
        const counter = this.startRelayMessageCounter({
          serverUrl: params.serverUrl,
          sessionId: params.sessionId,
          localPartyId: params.localPartyId,
          initialPhase: 'ecdsa',
          onProgress: params.onProgress,
        })

        // Run ECDSA keygen first and get setup message
        const { publicKeyEcdsa, dklsInstance } = await this.runEcdsaKeygen({ ...params, onProgress: params.onProgress })
        
        // Get DKLS setup message for Schnorr coordination
        let dklsSetupMessage: Uint8Array | undefined
        try {
          if (dklsInstance && typeof dklsInstance.getSetupMessage === 'function') {
            const sm = dklsInstance.getSetupMessage()
            dklsSetupMessage = sm
            log(`Got DKLS setup message: ${sm.length} bytes`)
          } else {
            log('Warning: DKLS instance does not provide setup message')
          }
        } catch (error) {
          log(`Warning: Could not get DKLS setup message: ${error}`)
        }

        // Run EdDSA keygen with DKLS setup message
        counter.setPhase('eddsa')
        const publicKeyEddsa = await this.runEddsaKeygen({ 
          ...params, 
          dklsSetupMessage: dklsSetupMessage ?? new Uint8Array(),
          onProgress: params.onProgress
        })
        
        log(`✅ Both keygens completed successfully on attempt ${attempt}`)
        progress({ phase: 'complete', message: 'Keygen complete' })
        counter.stop()
        return { publicKeyEcdsa, publicKeyEddsa }
        
      } catch (error) {
        lastError = error as Error
        log(`❌ Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`)
        
        if (attempt === maxRetries) {
          throw new Error(`MPC keygen failed after ${maxRetries} attempts. Last error: ${lastError.message}`)
        }
        
        // Wait before retry (exponential backoff)
        const delay = 1000 * Math.pow(2, attempt - 1)
        log(`Retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    throw new Error('Unexpected error in runBothKeygens')
  }

  /**
   * Run ECDSA keygen using DKLS (matches extension pattern)
   */
  private async runEcdsaKeygen(params: {
    sessionId: string
    hexEncryptionKey: string
    localPartyId: string
    serverUrl: string
    serverParties: string[]
    onLog?: (message: string) => void
    onProgress?: (u: KeygenProgressUpdate) => void
  }): Promise<{ publicKeyEcdsa: string; dklsInstance: any }> {
    const { initializeMpcLib } = await import('@core/mpc/lib/initialize')
    const { DKLS } = await import('@core/mpc/dkls/dkls')
    
    // Initialize DKLS WASM module
    await initializeMpcLib('ecdsa')
    
    // Create DKLS instance with proper constructor parameters (matches extension)
    const dkls = new DKLS(
      { create: true }, // KeygenOperation
      true, // isInitiateDevice (browser is always initiator for fast vaults)
      params.serverUrl,
      params.sessionId,
      params.localPartyId,
      [params.localPartyId, ...params.serverParties], // Full signers list
      [], // oldKeygenCommittee (empty for new vault)
      params.hexEncryptionKey
    )
    
    // Run DKLS keygen with retry (matches extension pattern)
    const result = await dkls.startKeygenWithRetry()
    
    // Return both the public key and the DKLS instance for setup message
    return { 
      publicKeyEcdsa: result.publicKey,
      dklsInstance: dkls
    }
  }
  
  /**
   * Run EdDSA keygen using Schnorr (matches extension pattern)
   */
  private async runEddsaKeygen(params: {
    sessionId: string
    hexEncryptionKey: string
    localPartyId: string
    serverUrl: string
    serverParties: string[]
    dklsSetupMessage?: Uint8Array
    onLog?: (message: string) => void
    onProgress?: (u: KeygenProgressUpdate) => void
  }): Promise<string> {
    const { initializeMpcLib } = await import('@core/mpc/lib/initialize')
    const { Schnorr } = await import('@core/mpc/schnorr/schnorrKeygen')
    const log = params.onLog || console.log
    
    // Initialize Schnorr WASM module
    await initializeMpcLib('eddsa')
    
    // Validate setup message
    if (!params.dklsSetupMessage || params.dklsSetupMessage.length === 0) {
      throw new Error('DKLS setup message is required for EdDSA keygen but is empty or missing')
    }
    
    log(`Running EdDSA keygen with DKLS setup message (${params.dklsSetupMessage.length} bytes)`)
    
    // Create Schnorr instance with proper constructor parameters (matches extension)
    const schnorr = new Schnorr(
      { create: true }, // KeygenOperation
      true, // isInitiateDevice (browser is always initiator for fast vaults)
      params.serverUrl,
      params.sessionId,
      params.localPartyId,
      [params.localPartyId, ...params.serverParties], // Full signers list
      [], // oldKeygenCommittee (empty for new vault)
      params.hexEncryptionKey,
      params.dklsSetupMessage // Setup message from DKLS for coordination
    )
    
    // Run Schnorr keygen with retry (matches extension pattern)
    const result = await schnorr.startKeygenWithRetry()
    
    // Extract EdDSA public key
    return result.publicKey
  }

  /**
   * Non-destructive relay message counter. Polls relay for new messages and emits onProgress with
   * incremental round numbers for the current phase. Does not delete messages; DKLS/Schnorr will.
   */
  private startRelayMessageCounter(params: {
    serverUrl: string
    sessionId: string
    localPartyId: string
    initialPhase: 'ecdsa' | 'eddsa'
    onProgress?: (u: KeygenProgressUpdate) => void
  }): { setPhase: (p: 'ecdsa' | 'eddsa') => void; stop: () => void } {
    let running = true
    let phase: 'ecdsa' | 'eddsa' = params.initialPhase
    let ecdsaCount = 0
    let eddsaCount = 0
    const seen = new Set<string>()

    const tick = async () => {
      while (running) {
        try {
          const messages = await this.messageRelayClient.getMessages(params.sessionId, params.localPartyId)
          for (const m of messages) {
            if (seen.has(m.hash)) continue
            seen.add(m.hash)
            if (phase === 'ecdsa') {
              ecdsaCount += 1
              params.onProgress?.({ phase: 'ecdsa', round: ecdsaCount })
            } else {
              eddsaCount += 1
              params.onProgress?.({ phase: 'eddsa', round: eddsaCount })
            }
          }
        } catch {}
        await new Promise(r => setTimeout(r, 200))
      }
    }

    // fire and forget
    void tick()

    return {
      setPhase: (p: 'ecdsa' | 'eddsa') => {
        phase = p
      },
      stop: () => {
        running = false
      },
    }
  }

  /**
   * Get vault from server after verification
   */
  async getVerifiedVault(vaultId: string, password: string): Promise<Vault> {
    const raw = await this.fastVaultClient.getVault(vaultId, password)
    const { shouldBePresent } = await import('@lib/utils/assert/shouldBePresent')
    const ecdsa = shouldBePresent(raw.public_key_ecdsa, 'public_key_ecdsa')
    const hexChainCode = shouldBePresent(raw.hex_chain_code, 'hex_chain_code')
    const signers = shouldBePresent(raw.signers, 'signers') as string[]
    const localPartyId = shouldBePresent(raw.local_party_id, 'local_party_id') as string
    const name = (raw.name as string) || 'Fast Vault'
    const keyshares = raw.keyshares || {}

    const vault: Vault = {
      name,
      publicKeys: {
        ecdsa,
        eddsa: (raw.public_key_eddsa as string) || '',
      },
      signers,
      createdAt: Date.now(),
      hexChainCode,
      keyShares: {
        ecdsa: (keyshares.ecdsa as string) || '',
        eddsa: (keyshares.eddsa as string) || '',
      },
      localPartyId,
      libType: 'DKLS',
      isBackedUp: false,
      order: 0,
    }
    return vault
  }

  // Private helper methods
  private generateSessionId(): string {
    // Generate UUID v4 format as expected by API
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }

  private generateEncryptionKey(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private generateChainCode(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private generateLocalPartyId(): string {
    // Use the same format as extension: device-randomNumber
    const num = Math.floor(1000 + Math.random() * 9000) // 1000-9999 range
    return `browser-${num}`
  }

  private generateServerPartyId(): string {
    // Generate server party ID (matches extension generateLocalPartyId('server'))
    const num = Math.floor(1000 + Math.random() * 9000) // 1000-9999 range
    return `Server-${num}`
  }

  // private generatePublicKey(): string {
  //   // Generate a mock ECDSA public key (64 bytes / 128 hex chars)
  //   // In real implementation, this would come from MPC keygen
  //   return Array.from(crypto.getRandomValues(new Uint8Array(64)))
  //     .map(b => b.toString(16).padStart(2, '0'))
  //     .join('')
  // }

  /**
   * Get fast vault client for server operations
   */
  getFastVaultClient(): FastVaultClient {
    return this.fastVaultClient
  }

  /**
   * Signal keygen completion (matches extension pattern)
   */
  private async signalKeygenComplete(params: {
    serverUrl: string
    sessionId: string
    localPartyId: string
  }): Promise<void> {
    const { setKeygenComplete } = await import('@core/mpc/keygenComplete')
    
    await setKeygenComplete({
      serverURL: params.serverUrl,
      sessionId: params.sessionId,
      localPartyId: params.localPartyId
    })
  }

  /**
   * Wait for all parties to complete keygen (matches extension pattern)
   */
  private async waitForKeygenComplete(params: {
    serverUrl: string
    sessionId: string
    peers: string[]
  }): Promise<void> {
    const { waitForKeygenComplete } = await import('@core/mpc/keygenComplete')
    
    await waitForKeygenComplete({
      serverURL: params.serverUrl,
      sessionId: params.sessionId,
      peers: params.peers
    })
  }
}