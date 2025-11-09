import { Signature, SigningPayload, Vault } from '../types'
import { WASMManager } from '../wasm/WASMManager'

/**
 * Fast signing service for server-assisted signing (2-of-2 MPC with VultiServer)
 *
 * Flow:
 * 1. Validate vault is a fast vault (has VultiServer signer)
 * 2. Get WalletCore instance
 * 3. Use pre-computed message hashes from SigningPayload
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
   * @param payload Signing payload with transaction data (must include messageHashes)
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

    // Step 2: Validate message hashes are provided
    if (!payload.messageHashes || payload.messageHashes.length === 0) {
      throw new Error(
        'SigningPayload must include pre-computed messageHashes. ' +
          'Use Vault.prepareSendTx() to generate transaction payloads with message hashes.'
      )
    }

    // Step 3: Get WalletCore instance
    const walletCore = await this.wasmManager.getWalletCore()

    console.log(
      `📝 Using ${payload.messageHashes.length} pre-computed message hash(es)`
    )

    // Step 4: Coordinate fast signing with server
    // ServerManager handles: API calls, relay session, MPC coordination, keysign
    console.log(`🚀 Starting fast signing coordination with VultiServer...`)
    const signature = await this.serverManager.coordinateFastSigning({
      vault,
      messages: payload.messageHashes,
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
