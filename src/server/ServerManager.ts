import type {
  KeygenProgressUpdate,
  ReshareOptions,
  ServerStatus,
  Signature,
  SigningPayload,
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
      const { verifyVaultEmailCode } = await import(
        '../core/mpc/fast/api/verifyVaultEmailCode'
      )
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
      responseType: 'none',
    })
  }

  /**
   * Get vault from VultiServer using password
   */
  async getVaultFromServer(vaultId: string, password: string): Promise<Vault> {
    const { getVaultFromServer } = await import(
      '../core/mpc/fast/api/getVaultFromServer'
    )

    const result = await getVaultFromServer({ vaultId, password })
    return result as Vault
  }

  /**
   * Sign transaction using VultiServer
   */
  async signWithServer(
    vault: any,
    payload: SigningPayload,
    vaultPassword: string
  ): Promise<Signature> {
    // Validate vault is a fast vault
    const hasFastVaultServer = vault.signers.some(signer =>
      signer.startsWith('Server-')
    )
    if (!hasFastVaultServer) {
      throw new Error(
        'Vault does not have VultiServer - fast signing not available'
      )
    }

    // Use core functions directly
    const { getChainKind } = await import('../core/chain/ChainKind')
    const { signatureAlgorithms } = await import(
      '../core/chain/signing/SignatureAlgorithm'
    )
    const { getCoinType } = await import('../core/chain/coin/coinType')
    const { joinMpcSession } = await import(
      '../core/mpc/session/joinMpcSession'
    )
    const { signWithServer: callFastVaultAPI } = await import(
      '../core/mpc/fast/api/signWithServer'
    )
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
      messages = await this.computeMessageHashesFromTransaction(
        payload,
        walletCore,
        chain,
        vault
      )
    }

    // Generate session parameters
    const sessionId = generateSessionId() // Use our own session ID consistently
    const hexEncryptionKey = await generateEncryptionKey()

    // Generate a new local party ID for this signing session (like extension does)
    const { generateLocalPartyId } = await import(
      '../core/mpc/devices/localPartyId'
    )
    const signingLocalPartyId = generateLocalPartyId('extension' as any)
    console.log(`🔑 Generated signing party ID: ${signingLocalPartyId}`)

    // Step 1: Call FastVault server API with our session ID
    console.log(`📡 Calling FastVault API with session ID: ${sessionId}`)
    const serverResponse = await callFastVaultAPI({
      public_key: vault.publicKeys.ecdsa,
      messages,
      session: sessionId, // Use our session ID, not server's returned one
      hex_encryption_key: hexEncryptionKey,
      derive_path: derivePath,
      is_ecdsa: signatureAlgorithm === 'ecdsa',
      vault_password: vaultPassword,
    })
    console.log(`✅ Server acknowledged session: ${serverResponse}`)

    // Step 2: Join relay session as client with new signing party ID
    await joinMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      localPartyId: signingLocalPartyId,
    })

    // Step 2.5: Register server as participant (critical for server to join)
    try {
      const { queryUrl } = await import('../lib/utils/query/queryUrl')
      // Find the server signer from the vault
      const serverSigner = vault.signers.find(signer =>
        signer.startsWith('Server-')
      )
      if (serverSigner) {
        await queryUrl(`${this.config.messageRelay}/${sessionId}`, {
          body: [serverSigner],
          responseType: 'none',
        })
      }
    } catch {
      // non-fatal
    }

    // Wait for server to join session
    console.log('⏳ Waiting for server to join session...')
    const devices = await this.waitForPeers(sessionId, signingLocalPartyId)
    const peers = devices.filter(device => device !== signingLocalPartyId)
    console.log(`✅ All participants ready: [${devices.join(', ')}]`)
    console.log(`🤝 Peer devices: [${peers.join(', ')}]`)

    // Step 2.5: Start MPC session with devices list (CRITICAL MISSING STEP)
    console.log('📡 Starting MPC session with devices list...')
    const { startMpcSession } = await import(
      '../core/ui/mpc/session/utils/startMpcSession'
    )
    await startMpcSession({
      serverUrl: this.config.messageRelay,
      sessionId,
      devices,
    })
    console.log('✅ MPC session started with devices')

    // Step 3: Perform MPC keysign using core implementation
    console.log('🔐 Starting core MPC keysign process...')
    const { keysign } = await import('../core/mpc/keysign')
    const { getTxInputData } = await import('../core/mpc/keysign/txInputData')
    const { getPublicKey } = await import(
      '../core/chain/publicKey/getPublicKey'
    )
    const { compileTx } = await import('../core/chain/tx/compile/compileTx')
    const { decodeSigningOutput } = await import(
      '../core/chain/tw/signingOutput'
    )

    const keyShare = vault.keyShares[signatureAlgorithm]
    if (!keyShare) {
      throw new Error(`No key share found for algorithm: ${signatureAlgorithm}`)
    }

    // If this is a UTXO chain (e.g., BTC), there may be multiple messages. Sign all.
    const isUtxo = chainKind === 'utxo'
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
      console.log(`✅ Signature result:`, sig)
      signatureResults[msg] = sig
    }

    // If single-message chains (e.g., EVM), return the single signature as before
    if (!isUtxo) {
      const only = messages[0]
      const sigResult = signatureResults[only]
      const recoveryId = sigResult.recovery_id
        ? parseInt(sigResult.recovery_id, 16)
        : undefined

      console.log(`🎯 Final signature for EVM:`, {
        signature: sigResult.der_signature,
        format:
          signatureAlgorithm === 'eddsa'
            ? 'EdDSA'
            : recoveryId !== undefined
              ? 'ECDSA'
              : 'DER',
        recovery: recoveryId,
      })

      return {
        signature: sigResult.der_signature,
        format:
          signatureAlgorithm === 'eddsa'
            ? 'EdDSA'
            : recoveryId !== undefined
              ? 'ECDSA'
              : 'DER',
        recovery: recoveryId,
      }
    }

    // UTXO/BTC path: compile the fully signed transaction
    // Recreate tx input data and public key to compile
    const { create } = await import('@bufbuild/protobuf')
    const { KeysignPayloadSchema } = await import(
      '../core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
    )
    const { deriveAddress } = await import(
      '../core/chain/publicKey/address/deriveAddress'
    )

    const publicKey = getPublicKey({
      chain,
      walletCore,
      hexChainCode: vault.hexChainCode,
      publicKeys: vault.publicKeys,
    })
    const address = deriveAddress({ chain, publicKey, walletCore })
    const psbtBase64 = (payload as any)?.transaction?.psbtBase64
    const keysignPayload = create(KeysignPayloadSchema, {
      coin: {
        chain: 'bitcoin',
        address,
      },
      blockchainSpecific: {
        case: 'utxoSpecific',
        value: {
          $typeName: 'vultisig.keysign.v1.UTXOSpecific',
          byteFee: '1',
          sendMaxAmount: false,
        },
      },
      toAddress: address,
      toAmount: '0',
      memo: psbtBase64,
    })

    const inputs = getTxInputData({
      keysignPayload,
      walletCore,
      publicKey,
    })

    // Extract just the DER signatures for compilation
    const derSignatures: Record<string, any> = {}
    for (const [msg, sigResult] of Object.entries(signatureResults)) {
      derSignatures[msg] = sigResult.der_signature
    }

    const compiledTxs = inputs.map(txInputData =>
      compileTx({
        publicKey,
        txInputData,
        signatures: derSignatures,
        chain,
        walletCore,
      })
    )

    // For UTXO, we expect a single compiled transaction
    const [compiled] = compiledTxs
    const decoded = decodeSigningOutput(chain, compiled)
    const finalTxHex = (decoded as any).encoded || compiled

    console.log('✅ UTXO transaction compiled successfully')
    return {
      signature: finalTxHex,
      format: 'DER',
    }
  }

  /**
   * Reshare vault participants
   */
  async reshareVault(
    vault: Vault,
    reshareOptions: ReshareOptions & { password: string; email?: string }
  ): Promise<Vault> {
    const { reshareWithServer } = await import(
      '../core/mpc/fast/api/reshareWithServer'
    )

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
    const { setupVaultWithServer } = await import(
      '../core/mpc/fast/api/setupVaultWithServer'
    )
    const { joinMpcSession } = await import(
      '../core/mpc/session/joinMpcSession'
    )
    const { startMpcSession } = await import(
      '../core/ui/mpc/session/utils/startMpcSession'
    )

    // Generate session parameters using core MPC utilities
    const sessionId = generateSessionId()
    const { generateHexEncryptionKey } = await import(
      '../core/mpc/utils/generateHexEncryptionKey'
    )
    const { generateHexChainCode } = await import(
      '../core/mpc/utils/generateHexChainCode'
    )
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

    const { DKLS } = await import('../core/mpc/dkls/dkls')
    const { Schnorr } = await import('../core/mpc/schnorr/schnorrKeygen')
    const { setKeygenComplete, waitForKeygenComplete } = await import(
      '../core/mpc/keygenComplete'
    )

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
    const { queryUrl } = await import('../lib/utils/query/queryUrl')
    const { without } = await import('../lib/utils/array/without')
    const { withoutDuplicates } = await import(
      '../lib/utils/array/withoutDuplicates'
    )

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

  private async computeMessageHashesFromTransaction(
    payload: SigningPayload,
    walletCore: any,
    chain: any,
    vault: any
  ): Promise<string[]> {
    const network = String(payload.chain || '').toLowerCase()
    if (network === 'ethereum' || network === 'eth') {
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

    // UTXO/BTC: derive pre-signing hashes from PSBT or constructed inputs
    if (network === 'bitcoin' || network === 'btc') {
      const { create } = await import('@bufbuild/protobuf')
      const { KeysignPayloadSchema } = await import(
        '../core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
      )
      const { getTxInputData } = await import('../core/mpc/keysign/txInputData')
      const { getPreSigningHashes } = await import(
        '../core/chain/tx/preSigningHashes'
      )
      const { getPublicKey } = await import(
        '../core/chain/publicKey/getPublicKey'
      )
      const { deriveAddress } = await import(
        '../core/chain/publicKey/address/deriveAddress'
      )

      const publicKey = getPublicKey({
        chain,
        walletCore,
        hexChainCode: vault.hexChainCode,
        publicKeys: vault.publicKeys,
      })
      const address = deriveAddress({ chain, publicKey, walletCore })
      const psbtBase64 = (payload as any)?.transaction?.psbtBase64
      if (!psbtBase64) {
        throw new Error('BTC signing requires transaction.psbtBase64')
      }

      const keysignPayload = create(KeysignPayloadSchema, {
        coin: {
          chain: 'bitcoin',
          address,
        },
        blockchainSpecific: {
          case: 'utxoSpecific',
          value: {
            $typeName: 'vultisig.keysign.v1.UTXOSpecific',
            byteFee: '1',
            sendMaxAmount: false,
          },
        },
        toAddress: address,
        toAmount: '0',
        memo: psbtBase64,
      })

      const inputs = getTxInputData({
        keysignPayload,
        walletCore,
        publicKey,
      })
      const hashes = inputs
        .flatMap(txInputData =>
          getPreSigningHashes({ walletCore, chain, txInputData })
        )
        .map(value => Buffer.from(value).toString('hex'))
      return hashes
    }

    throw new Error(
      `Message hash computation not yet implemented for chain: ${payload.chain}`
    )
  }
}
