import { Chain } from '@core/chain/Chain'
import { WalletCore } from '@trustwallet/wallet-core'
import { Vault } from '../../types'

/**
 * Build keysign payload for MPC signing
 *
 * This adapter coordinates with core's keysign functions to build
 * the complete payload needed for MPC signing operations.
 *
 * The payload includes:
 * - Transaction data (chain-specific)
 * - Signing inputs (protobuf encoded)
 * - Chain-specific metadata
 * - Public keys and derivation paths
 *
 * Note: This is a placeholder. The actual implementation will be done
 * when we implement the signing flow in the Vault class, as it requires
 * deep integration with core's keysign system.
 *
 * @param payload Signing payload from SDK
 * @param chain Chain enum value
 * @param walletCore WalletCore WASM instance
 * @param vaultData Vault data with keys and signers
 * @returns Keysign payload ready for MPC signing
 */
export async function buildKeysignPayload(
  payload: any,
  chain: Chain,
  walletCore: WalletCore,
  vaultData: Vault
): Promise<any> {
  // TODO: Implement in Phase 3.5 (Signing methods)
  // This will use:
  // - getKeysignTxData() from @core/mpc/keysign/txData
  // - buildChainSpecific() from @core/mpc/keysign/chainSpecific/build
  // - getEncodedSigningInputs() from @core/mpc/keysign/signingInputs

  throw new Error('buildKeysignPayload not yet implemented - will be completed in Phase 3.5')
}
