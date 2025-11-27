import { Vault as CoreVault } from '@core/mpc/vault/Vault'

import type { WasmProvider } from '../context/SdkContext'
import { ServerManager } from '../server/ServerManager'
import { Signature, SigningMode, SigningPayload, SigningStep } from '../types'

/**
 * Fast signing service for server-assisted signing (2-of-2 MPC with VultiServer)
 *
 * Flow:
 * 1. Validate vault is a fast vault (has VultiServer signer)
 * 2. Get WalletCore instance via WasmProvider
 * 3. Use pre-computed message hashes from SigningPayload
 * 4. Coordinate fast signing with ServerManager (MPC session, relay, keysign)
 * 5. Return formatted signature
 */
export class FastSigningService {
  constructor(
    private serverManager: ServerManager,
    private wasmProvider: WasmProvider
  ) {}

  /**
   * Sign transaction with VultiServer assistance (2-of-2 threshold signing)
   * @param vault Vault data with keys and signers
   * @param payload Signing payload with transaction data (must include messageHashes)
   * @param vaultPassword Password for vault encryption
   * @param onProgress Optional callback for signing progress updates
   * @returns Signed transaction ready for broadcast
   */
  async signWithServer(
    vault: CoreVault,
    payload: SigningPayload,
    vaultPassword: string,
    onProgress?: (step: SigningStep) => void
  ): Promise<Signature> {
    const reportProgress = onProgress || (() => {})

    // Step 1: Preparing
    reportProgress({
      step: 'preparing',
      progress: 0,
      message: 'Preparing transaction for signing...',
      mode: 'fast' as SigningMode,
      participantCount: 2,
      participantsReady: 0,
    })

    // Validate vault has server signer
    this.validateFastVault(vault)

    // Validate message hashes are provided
    if (!payload.messageHashes || payload.messageHashes.length === 0) {
      throw new Error(
        'SigningPayload must include pre-computed messageHashes. ' +
          'Use Vault.prepareSendTx() to generate transaction payloads with message hashes.'
      )
    }

    // Get WalletCore instance via WasmProvider
    const walletCore = await this.wasmProvider.getWalletCore()

    console.log(`📝 Using ${payload.messageHashes.length} pre-computed message hash(es)`)

    reportProgress({
      step: 'preparing',
      progress: 20,
      message: 'Transaction prepared, connecting to signing service...',
      mode: 'fast' as SigningMode,
      participantCount: 2,
      participantsReady: 1,
    })

    // Step 2: Coordinate fast signing with server
    // ServerManager handles: API calls, relay session, MPC coordination, keysign
    console.log(`🚀 Starting fast signing coordination with VultiServer...`)
    const signature = await this.serverManager.coordinateFastSigning({
      vault,
      messages: payload.messageHashes,
      password: vaultPassword,
      payload,
      walletCore,
      onProgress: reportProgress,
    })

    console.log(`✅ Fast signing completed successfully`)
    return signature
  }

  /**
   * Validate that vault has VultiServer as signer (required for fast signing)
   * @param vault Vault to validate
   * @throws Error if vault doesn't have server signer
   */
  private validateFastVault(vault: CoreVault): void {
    const hasFastVaultServer = vault.signers.some((signer: string) => signer.startsWith('Server-'))

    if (!hasFastVaultServer) {
      throw new Error(
        'Vault does not have VultiServer - fast signing not available. ' +
          'Only fast vaults (2-of-2 with server) support this operation.'
      )
    }
  }
}
