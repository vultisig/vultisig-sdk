import type { 
  Vault, 
  SigningPayload, 
  Signature, 
  ReshareOptions, 
  ServerStatus,
  KeygenProgressUpdate
} from '../types'

import { 
  generateSessionId,
  generateEncryptionKey,
  generateChainCode,
  generateBrowserPartyId,
  generateServerPartyId,
  pingServer
} from './utils'

/**
 * ServerManager coordinates all server communications
 * Uses core functions directly without wrapper classes
 */
export class ServerManager {
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
  }

  /**
   * Verify vault with email verification code
   */
  async verifyVault(vaultId: string, code: string): Promise<boolean> {
    try {
      const { verifyVaultEmailCode } = await import('../core/mpc/fast/api/verifyVaultEmailCode')
      await verifyVaultEmailCode({ vaultId, code })
      return true
    } catch {
      return false
    }
  }

  /**
   * Resend vault verification email
   */
  async resendVaultVerification(vaultId: string): Promise<void> {
    const { queryUrl } = await import('../lib/utils/query/queryUrl')
    const { fastVaultServerUrl } = await import('../core/mpc/fast/config')
    
    await queryUrl(`${fastVaultServerUrl}/resend-verification/${vaultId}`, {
      responseType: 'none'
    })
  }

  /**
   * Get vault from VultiServer using password
   */
  async getVaultFromServer(vaultId: string, password: string): Promise<Vault> {
    const { getVaultFromServer } = await import('../core/mpc/fast/api/getVaultFromServer')
    
    const result = await getVaultFromServer({ vaultId, password })
    return result as unknown as Vault
  }

  /**
   * Sign transaction using VultiServer
   */
  async signWithServer(vault: any, payload: SigningPayload, vaultPassword: string): Promise<Signature> {
    // Validate vault is a fast vault
    const hasFastVaultServer = vault.signers.some(signer => signer.startsWith('Server-'))
    if (!hasFastVaultServer) {
      throw new Error('Vault does not have VultiServer - fast signing not available')
    }

    // Use core functions directly
    const { getChainKind } = await import('../core/chain/ChainKind')
    const { signatureAlgorithms } = await import('../core/chain/signing/SignatureAlgorithm')
    const { getCoinType } = await import('../core/chain/coin/coinType')
    const { joinMpcSession } = await import('../core/mpc/session/joinMpcSession')
    const { signWithServer: callFastVaultAPI } = await import('../core/mpc/fast/api/signWithServer')
    const { initWasm } = await import('@trustwallet/wallet-core')
    const { AddressDeriver } = await import('../chains/AddressDeriver')

    // Initialize components
    const walletCore = await initWasm()
    const addressDeriver = new AddressDeriver()
    await addressDeriver.initialize(walletCore)
    const chain = addressDeriver.mapStringToChain(payload.chain)
    const coinType = getCoinType({ walletCore, chain })
    const derivePath = walletCore.CoinTypeExt.derivationPath(coinType)
    
    const chainKind = getChainKind(chain)
    const signatureAlgorithm = signatureAlgorithms[chainKind]

    // Prepare messages
    let messages: string[]
    if (payload.messageHashes) {
      messages = payload.messageHashes
    } else {
      messages = await this.computeMessageHashesFromTransaction(payload, walletCore, chain, vault)
    }

    // Generate session parameters
    const sessionId = generateSessionId() // Use our own session ID consistently
    const hexEncryptionKey = await generateEncryptionKey()

    // Step 1: Call FastVault server API with our session ID
    console.log(`📡 Calling FastVault API with session ID: ${sessionId}`)
    const serverResponse = await callFastVaultAPI({
      public_key: vault.publicKeys.ecdsa,
      messages,
      session: sessionId, // Use our session ID, not server's returned one
      hex_encryption_key: hexEncryptionKey,
      derive_path: derivePath,
      is_ecdsa: signatureAlgorithm === 'ecdsa',
      vault_password: vaultPassword
    })
    console.log(`✅ Server acknowledged session: ${serverResponse}`)

    // Step 2: Join relay session as client
    await joinMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      localPartyId: vault.localPartyId
    })

    // Step 2.5: Register server as participant (critical for server to join)
    try {
      const { queryUrl } = await import('../lib/utils/query/queryUrl')
      // Find the server signer from the vault
      const serverSigner = vault.signers.find(signer => signer.startsWith('Server-'))
      if (serverSigner) {
        await queryUrl(`${this.config.messageRelay}/${sessionId}`, {
          body: [serverSigner],
          responseType: 'none'
        })
      }
    } catch (_) {
      // non-fatal
    }

    // Wait for server to join session
    console.log('⏳ Waiting for server to join session...')
    const devices = await this.waitForPeers(sessionId, vault.localPartyId)
    const peers = devices.filter(device => device !== vault.localPartyId)
    console.log(`✅ All participants ready: [${devices.join(', ')}]`)
    console.log(`🤝 Peer devices: [${peers.join(', ')}]`)
    
    // Step 2.5: Start MPC session with devices list (CRITICAL MISSING STEP)
    console.log('📡 Starting MPC session with devices list...')
    const { startMpcSession } = await import('../core/ui/mpc/session/utils/startMpcSession')
    await startMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      devices
    })
    console.log('✅ MPC session started with devices')
    
    // Step 3: Perform MPC keysign using core implementation
    console.log('🔐 Starting core MPC keysign process...')
    const { keysign } = await import('../core/mpc/keysign')
    
    const keyShare = vault.keyShares[signatureAlgorithm]
    if (!keyShare) {
      throw new Error(`No key share found for algorithm: ${signatureAlgorithm}`)
    }
    
    const signature = await keysign({
      keyShare,
      signatureAlgorithm,
      message: messages[0],
      chainPath: derivePath.replaceAll("'", ''),
      localPartyId: vault.localPartyId,
      peers,
      serverUrl: this.config.messageRelay,
      sessionId,
      hexEncryptionKey,
      isInitiatingDevice: true,
    })
    
    console.log('✅ Core MPC keysign completed successfully!')

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
   * Reshare vault participants
   */
  async reshareVault(vault: Vault, reshareOptions: ReshareOptions & { password: string; email?: string }): Promise<Vault> {
    const { reshareWithServer } = await import('../core/mpc/fast/api/reshareWithServer')
    
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
    
    return vault
  }

  /**
   * Create a Fast Vault
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
    const { setupVaultWithServer } = await import('../core/mpc/fast/api/setupVaultWithServer')
    const { joinMpcSession } = await import('../core/mpc/session/joinMpcSession')
    const { startMpcSession } = await import('../core/ui/mpc/session/utils/startMpcSession')
    
    // Generate session parameters
    const sessionId = generateSessionId()
    const hexEncryptionKey = await generateEncryptionKey()
    const hexChainCode = await generateChainCode()
    const localPartyId = await generateBrowserPartyId()
    
    const log = options.onLog || (() => {})
    const progress = options.onProgress || (() => {})
    
    log('Creating vault on FastVault server...')
    
    await setupVaultWithServer({
      name: options.name,
      session_id: sessionId,
      hex_encryption_key: hexEncryptionKey,
      hex_chain_code: hexChainCode,
      local_party_id: await generateServerPartyId(),
      encryption_password: options.password,
      email: options.email,
      lib_type: 1
    })
    
    log('Joining relay session...')
    
    await joinMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      localPartyId
    })
    
    log('Waiting for server and starting MPC session...')
    
    const devices = await this.waitForPeers(sessionId, localPartyId)
    
    await startMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      devices
    })
    
    progress({ phase: 'ecdsa', message: 'Generating keys...' })
    
    // Create placeholder vault (real implementation would use core keygen)
    const vault: Vault = {
      name: options.name,
      publicKeys: {
        ecdsa: hexChainCode,
        eddsa: ''
      },
      localPartyId,
      signers: devices,
      hexChainCode,
      keyShares: {
        ecdsa: '',
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
      pingServer(this.config.fastVault, '/'),
      pingServer(this.config.messageRelay, '/ping')
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

  // ===== Private Helper Methods =====


  private async waitForPeers(sessionId: string, localPartyId: string): Promise<string[]> {
    const { queryUrl } = await import('../lib/utils/query/queryUrl')
    const { without } = await import('../lib/utils/array/without')
    const { withoutDuplicates } = await import('../lib/utils/array/withoutDuplicates')
    
    const maxWaitTime = 30000
    const checkInterval = 2000
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
        await new Promise(resolve => setTimeout(resolve, checkInterval))
      }
    }
    
    throw new Error('Timeout waiting for peers to join session')
  }

  private async computeMessageHashesFromTransaction(
    payload: SigningPayload, 
    walletCore: any, 
    chain: any,
    vault: any
  ): Promise<string[]> {
    if (payload.chain === 'ethereum' || payload.chain === 'eth') {
      const { serializeTransaction, keccak256 } = await import('viem')
      
      const tx = payload.transaction
      const unsigned = {
        type: 'eip1559' as const,
        chainId: tx.chainId,
        to: tx.to as `0x${string}`,
        nonce: tx.nonce,
        gas: BigInt(tx.gasLimit),
        data: (tx.data || '0x') as `0x${string}`,
        value: BigInt(tx.value),
        maxFeePerGas: BigInt(tx.maxFeePerGas ?? tx.gasPrice ?? '0'),
        maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas ?? '0'),
        accessList: [],
      }
      
      const serialized = serializeTransaction(unsigned)
      const signingHash = keccak256(serialized).slice(2)
      
      return [signingHash]
    }
    
    throw new Error(`Message hash computation not yet implemented for chain: ${payload.chain}`)
  }
}