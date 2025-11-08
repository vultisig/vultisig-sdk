import { buildKeysignPayload } from '../adapters/buildKeysignPayload'
import { stringToChain } from '../ChainManager'
import { Signature, SigningPayload, Vault } from '../types'
import { WASMManager } from '../wasm/WASMManager'

/**
 * Fast signing service for server-assisted signing (2-of-2 MPC with VultiServer)
 * Functional adapter approach - uses core functions directly
 *
 * Flow:
 * 1. Validate vault is a fast vault (has VultiServer signer)
 * 2. Get WalletCore instance
 * 3. Build keysign payload using core functions via buildKeysignPayload adapter
 * 4. Coordinate fast signing with ServerManager (MPC session, relay, keysign)
 * 5. Return formatted signature
 */
export class FastSigningService {
  constructor(
    private serverManager: any,
    private wasmManager: WASMManager
  ) {}

  /**
   * Sign transaction with VultiServer assistance (2-of-2 threshold signing)
   * @param vault Vault data with keys and signers
   * @param payload Signing payload with transaction data
   * @param vaultPassword Password for vault encryption
   * @returns Signed transaction ready for broadcast
   */
  async signWithServer(
    vault: Vault,
    payload: SigningPayload,
    vaultPassword: string
  ): Promise<Signature> {
    // Step 1: Validate vault has server signer
    this.validateFastVault(vault)

    // Step 2: Get WalletCore instance
    const walletCore = await this.wasmManager.getWalletCore()

    // Step 3: Build keysign payload using core functions
    let messages: string[]

    if (payload.messageHashes && payload.messageHashes.length > 0) {
      // Use pre-computed message hashes if provided (for advanced use cases)
      console.log(
        `📝 Using ${payload.messageHashes.length} pre-computed message hash(es)`
      )
      messages = payload.messageHashes
    } else {
      // Build message hashes from transaction data using core keysign functions
      console.log(`🔨 Building keysign payload for ${payload.chain}...`)
      const chainEnum =
        typeof payload.chain === 'string'
          ? stringToChain(payload.chain)
          : payload.chain
      messages = await buildKeysignPayload(
        payload,
        chainEnum,
        walletCore,
        vault
      )
      console.log(
        `✅ Generated ${messages.length} message hash(es) for signing`
      )
    }

    // Step 4: Coordinate fast signing with server
    // ServerManager handles: API calls, relay session, MPC coordination, keysign
    console.log(`🚀 Starting fast signing coordination with VultiServer...`)
    const signature = await this.serverManager.coordinateFastSigning({
      vault,
      messages,
      password: vaultPassword,
      payload,
      walletCore,
    })

    console.log(`✅ Fast signing completed successfully`)
    return signature
  }

  /**
   * Validate that vault has VultiServer as signer (required for fast signing)
   * @param vault Vault to validate
   * @throws Error if vault doesn't have server signer
   */
  private validateFastVault(vault: Vault): void {
    const hasFastVaultServer = vault.signers.some(signer =>
      signer.startsWith('Server-')
    )

    if (!hasFastVaultServer) {
      throw new Error(
        'Vault does not have VultiServer - fast signing not available. ' +
          'Only fast vaults (2-of-2 with server) support this operation.'
      )
    }
  }
}
