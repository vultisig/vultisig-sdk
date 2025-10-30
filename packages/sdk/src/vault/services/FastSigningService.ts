import { Vault, SigningPayload, Signature } from '../../types'
import { ChainStrategyFactory } from '../../chains/strategies/ChainStrategyFactory'
import { initWasm } from '@trustwallet/wallet-core'

/**
 * Fast signing service for server-assisted signing (2-of-2 MPC with VultiServer)
 * Coordinates between ChainStrategy (chain logic) and ServerManager (server communication)
 *
 * Flow:
 * 1. Validate vault is a fast vault (has VultiServer signer)
 * 2. Get appropriate chain strategy (EVM, UTXO, Solana, etc.)
 * 3. Initialize WalletCore
 * 4. Compute pre-signing hashes via strategy.computePreSigningHashes()
 * 5. Coordinate fast signing with ServerManager (MPC session, relay, keysign)
 * 6. Format signature result via strategy.formatSignatureResult()
 */
export class FastSigningService {
  constructor(
    private serverManager: any,
    private strategyFactory: ChainStrategyFactory
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

    // Step 2: Get chain strategy for chain-specific operations
    const strategy = this.strategyFactory.getStrategy(payload.chain)

    // Step 3: Initialize WalletCore
    const walletCore = await initWasm()

    // Step 4: Compute pre-signing hashes (chain-specific via strategy)
    // Allow payload to provide pre-computed hashes, otherwise compute from transaction
    let messages: string[]
    if (payload.messageHashes && payload.messageHashes.length > 0) {
      console.log(`📝 Using ${payload.messageHashes.length} pre-computed message hash(es)`)
      messages = payload.messageHashes
    } else {
      console.log(`🔍 Computing pre-signing hashes for ${payload.chain}...`)
      messages = await strategy.computePreSigningHashes(payload, vault, walletCore)
      console.log(`✅ Computed ${messages.length} message hash(es) for signing`)
    }

    // Step 5: Coordinate fast signing with server
    // ServerManager handles: API calls, relay session, MPC coordination, keysign
    // Strategy handles: result formatting (chain-specific)
    console.log(`🚀 Starting fast signing coordination with VultiServer...`)
    const signature = await this.serverManager.coordinateFastSigning({
      vault,
      messages,
      password: vaultPassword,
      payload,
      strategy,
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
