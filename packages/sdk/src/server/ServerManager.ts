import {
  KeygenProgressUpdate,
  ReshareOptions,
  ServerStatus,
  Vault,
} from '../types'
import {
  generateBrowserPartyId,
  generateEncryptionKey,
  generateServerPartyId,
  generateSessionId,
  pingServer,
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

  constructor(endpoints?: { fastVault?: string; messageRelay?: string }) {
    this.config = {
      fastVault: endpoints?.fastVault || 'https://api.vultisig.com/vault',
      messageRelay:
        endpoints?.messageRelay || 'https://api.vultisig.com/router',
    }
  }

  /**
   * Verify vault with email verification code
   */
  async verifyVault(vaultId: string, code: string): Promise<boolean> {
    try {
      const { verifyVaultEmailCode } = await import('@core/mpc/fast/api/verifyVaultEmailCode')
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
    const { queryUrl } = await import('@lib/utils/query/queryUrl')
    const { fastVaultServerUrl } = await import('@core/mpc/fast/config')

    await queryUrl(`${fastVaultServerUrl}/resend-verification/${vaultId}`, {
      responseType: 'none',
    })
  }

  /**
   * Get vault from VultiServer using password
   *
   * NOTE: The core getVaultFromServer currently returns minimal data.
   * This needs to be updated to properly retrieve and decrypt the vault data.
   */
  async getVaultFromServer(vaultId: string, password: string): Promise<Vault> {
    const { getVaultFromServer } = await import('@core/mpc/fast/api/getVaultFromServer')

    const result = await getVaultFromServer({ vaultId, password })

    // TODO: Properly convert/decrypt the vault data from server response
    // Currently the core function returns { password } which is incomplete
    return result as unknown as Vault
  }

  /**
   * Coordinate fast signing with VultiServer (refactored version)
   * Pure server coordination - no chain-specific logic
   *
   * @param options.vault Vault with keys and signers
   * @param options.messages Pre-computed message hashes (from strategy.computePreSigningHashes())
   * @param options.password Vault password for encryption
   * @param options.payload Original signing payload
   * @param options.strategy Chain strategy for result formatting
   * @param options.walletCore WalletCore instance
   * @returns Formatted signature (via strategy.formatSignatureResult())
   */
  async coordinateFastSigning(options: {
    vault: any
    messages: string[]
    password: string
    payload: any
    strategy: any
    walletCore: any
  }): Promise<any> {
    const { vault, messages, password, payload, strategy, walletCore } = options

    // Import required utilities
    const { getChainKind } = await import('@core/chain/ChainKind')
    const { signatureAlgorithms } = await import('@core/chain/signing/SignatureAlgorithm')
    const { getCoinType } = await import('@core/chain/coin/coinType')
    const { joinMpcSession } = await import('@core/mpc/session/joinMpcSession')
    const { startMpcSession } = await import('@core/mpc/session/startMpcSession')
    const { signWithServer: callFastVaultAPI } = await import('@core/mpc/fast/api/signWithServer')
    const { ChainConfig } = await import('../chains/config/ChainConfig')
    const { generateLocalPartyId } = await import('@core/mpc/devices/localPartyId')
    const { keysign } = await import('@core/mpc/keysign')

    // Map chain string to Chain enum
    const chain = ChainConfig.getChainEnum(payload.chain)
    const coinType = getCoinType({ walletCore, chain })
    const derivePath = walletCore.CoinTypeExt.derivationPath(coinType)

    const chainKind = getChainKind(chain)
    const signatureAlgorithm = signatureAlgorithms[chainKind]

    // Generate session parameters
    const sessionId = generateSessionId()
    const hexEncryptionKey = await generateEncryptionKey()
    const signingLocalPartyId = generateLocalPartyId('extension' as any)

    console.log(`🔑 Generated signing party ID: ${signingLocalPartyId}`)
    console.log(`📡 Calling FastVault API with session ID: ${sessionId}`)

    // Step 1: Call FastVault API
    const serverResponse = await callFastVaultAPI({
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
    await joinMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      localPartyId: signingLocalPartyId,
    })

    // Step 2.5: Register server as participant
    try {
      const { queryUrl } = await import('@lib/utils/query/queryUrl')
      const serverSigner = vault.signers.find(signer => signer.startsWith('Server-'))
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
    const devices = await this.waitForPeers(sessionId, signingLocalPartyId)
    const peers = devices.filter(device => device !== signingLocalPartyId)
    console.log(`✅ All participants ready: [${devices.join(', ')}]`)

    // Step 4: Start MPC session
    console.log('📡 Starting MPC session with devices list...')
    await startMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      devices,
    })
    console.log('✅ MPC session started')

    // Step 5: Perform MPC keysign
    console.log('🔐 Starting MPC keysign process...')
    const keyShare = vault.keyShares[signatureAlgorithm]
    if (!keyShare) {
      throw new Error(`No key share found for algorithm: ${signatureAlgorithm}`)
    }

    // Sign all messages (UTXO can have multiple, EVM typically has one)
    const signatureResults: Record<string, any> = {}
    for (const msg of messages) {
      console.log(`🔏 Signing message: ${msg}`)
      const sig = await keysign({
        keyShare,
        signatureAlgorithm,
        message: msg,
        chainPath: derivePath.replaceAll("'", ''),
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

    // Step 6: Format signature result using strategy (chain-specific)
    console.log(`🔄 Formatting signature result via ${payload.chain} strategy...`)

    // Pass vault and walletCore in payload for strategy to use
    const enrichedPayload = {
      ...payload,
      vault,
      walletCore,
    }

    return strategy.formatSignatureResult(signatureResults, enrichedPayload)
  }

  /**
   * Reshare vault participants
   */
  async reshareVault(
    vault: Vault,
    reshareOptions: ReshareOptions & { password: string; email?: string }
  ): Promise<Vault> {
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
    onLog?: (msg: string) => void
    onProgress?: (u: KeygenProgressUpdate) => void
  }): Promise<{
    vault: Vault
    vaultId: string
    verificationRequired: boolean
  }> {
    const { setupVaultWithServer } = await import('@core/mpc/fast/api/setupVaultWithServer')
    const { joinMpcSession } = await import('@core/mpc/session/joinMpcSession')
    const { startMpcSession } = await import('@core/mpc/session/startMpcSession')

    // Generate session parameters using core MPC utilities
    const sessionId = generateSessionId()
    const { generateHexEncryptionKey } = await import('@core/mpc/utils/generateHexEncryptionKey')
    const { generateHexChainCode } = await import('@core/mpc/utils/generateHexChainCode')
    const hexEncryptionKey = generateHexEncryptionKey()
    const hexChainCode = generateHexChainCode()
    const localPartyId = await generateBrowserPartyId()

    const log = options.onLog || (() => {})
    const progress = options.onProgress || (() => {})

    log('Creating vault on FastVault server...')

    // The server party ID should be consistent throughout the process
    const serverPartyId = await generateServerPartyId()

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

    const devices = await this.waitForPeers(sessionId, localPartyId)

    await startMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      devices,
    })

    // Real MPC keygen - ECDSA first
    progress({ phase: 'ecdsa', message: 'Generating ECDSA keys...' })

    const { DKLS } = await import('@core/mpc/dkls/dkls')
    const { Schnorr } = await import('@core/mpc/schnorr/schnorrKeygen')
    const { setKeygenComplete, waitForKeygenComplete } = await import('@core/mpc/keygenComplete')

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
    const vault: Vault = {
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
      pingServer(this.config.fastVault, '/'),
      pingServer(this.config.messageRelay, '/ping'),
    ])

    return {
      fastVault: {
        online: fastVaultStatus.status === 'fulfilled',
        latency:
          fastVaultStatus.status === 'fulfilled'
            ? fastVaultStatus.value
            : undefined,
      },
      messageRelay: {
        online: relayStatus.status === 'fulfilled',
        latency:
          relayStatus.status === 'fulfilled' ? relayStatus.value : undefined,
      },
      timestamp: Date.now(),
    }
  }

  // ===== Private Helper Methods =====

  private async waitForPeers(
    sessionId: string,
    localPartyId: string
  ): Promise<string[]> {
    const { queryUrl } = await import('@lib/utils/query/queryUrl')
    const { without } = await import('@lib/utils/array/without')
    const { withoutDuplicates } = await import('@lib/utils/array/withoutDuplicates')

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
      } catch {
        await new Promise(resolve => setTimeout(resolve, checkInterval))
      }
    }

    throw new Error('Timeout waiting for peers to join session')
  }

}
