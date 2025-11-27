import { create } from '@bufbuild/protobuf'
import { Chain } from '@core/chain/Chain'
import { chainFeeCoin } from '@core/chain/coin/chainFeeCoin'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import { getChainSpecific } from '@core/mpc/keysign/chainSpecific'
import { toCommCoin } from '@core/mpc/types/utils/commCoin'
import { KeysignPayloadSchema } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import type { Vault as CoreVault } from '@core/mpc/vault/Vault'

import { formatGasInfo } from '../../adapters/formatGasInfo'
import type { WasmProvider } from '../../context/SdkContext'
import type { GasInfo } from '../../types'
import { VaultError, VaultErrorCode } from '../VaultError'

/**
 * GasEstimationService
 *
 * Handles gas and fee estimation for vault transactions.
 * Extracted from Vault.ts to reduce file size and improve maintainability.
 */
export class GasEstimationService {
  /**
   * Well-known active addresses for Cosmos chains
   * Used for gas estimation to avoid errors when user's address doesn't exist on-chain yet
   * Gas prices are global, so any active address works for estimation
   */
  private static readonly COSMOS_GAS_ESTIMATION_ADDRESSES: Partial<Record<Chain, string>> = {
    [Chain.THORChain]: 'thor1dheycdevq39qlkxs2a6wuuzyn4aqxhve4qxtxt',
    [Chain.Cosmos]: 'cosmos1fl48vsnmsdzcv85q5d2q4z5ajdha8yu34mf0eh',
    [Chain.Osmosis]: 'osmo1clpqr4nrk4khgkxj78fcwwh6dl3uw4epasmvnj',
    [Chain.MayaChain]: 'maya1dheycdevq39qlkxs2a6wuuzyn4aqxhveshhay9',
    [Chain.Kujira]: 'kujira1nynns8ex9fq6sjjfj8k79ymkdz4sqth0hdz2q8',
    [Chain.Dydx]: 'dydx1fl48vsnmsdzcv85q5d2q4z5ajdha8yu3l3qwf0',
  }

  constructor(
    private vaultData: CoreVault,
    private getAddress: (chain: Chain) => Promise<string>,
    private wasmProvider: WasmProvider
  ) {}

  /**
   * Get gas info for chain
   * Uses core's getChainSpecific() to estimate fees
   */
  async getGasInfo(chain: Chain): Promise<GasInfo> {
    console.log(`🔍 Starting gas estimation for chain: ${chain}`)
    let address: string | undefined
    try {
      console.log(`  📍 Getting address...`)

      // For Cosmos chains, use well-known addresses to avoid account-doesn't-exist errors
      // Gas prices are global, so any active address works for estimation
      const cosmosAddress = GasEstimationService.COSMOS_GAS_ESTIMATION_ADDRESSES[chain]
      if (cosmosAddress) {
        address = cosmosAddress
        console.log(`  📍 Using well-known address for Cosmos gas estimation: ${address}`)
      } else {
        address = await this.getAddress(chain)
        console.log(`  📍 Address: ${address}`)
      }

      // Get WalletCore via WasmProvider
      const walletCore = await this.wasmProvider.getWalletCore()

      // Get public key
      const publicKey = getPublicKey({
        chain,
        walletCore,
        publicKeys: this.vaultData.publicKeys,
        hexChainCode: this.vaultData.hexChainCode,
      })

      // Create minimal keysign payload to get fee data
      const minimalPayload = create(KeysignPayloadSchema, {
        coin: toCommCoin({
          chain,
          address,
          decimals: chainFeeCoin[chain].decimals,
          ticker: chainFeeCoin[chain].ticker,
          hexPublicKey: Buffer.from(publicKey.data()).toString('hex'),
        }),
        toAddress: address, // Dummy address for fee estimation
        toAmount: '1', // Minimal amount for fee estimation
        vaultLocalPartyId: this.vaultData.localPartyId,
        vaultPublicKeyEcdsa: this.vaultData.publicKeys.ecdsa,
        libType: this.vaultData.libType,
      })

      // Get chain-specific data with fee information
      console.log(`  ⛓️ Calling getChainSpecific()...`)
      const chainSpecific = await getChainSpecific({
        keysignPayload: minimalPayload,
        walletCore,
      })
      console.log(`  ✅ getChainSpecific() succeeded, formatting...`)

      // Format using adapter
      const result = formatGasInfo(chainSpecific, chain)
      console.log(`  ✅ formatGasInfo() succeeded`)
      return result
    } catch (error) {
      // Enhanced error logging for E2E test debugging
      const errorMessage = (error as Error)?.message || 'Unknown error'
      const errorName = (error as Error)?.name || 'Error'

      throw new VaultError(
        VaultErrorCode.GasEstimationFailed,
        `Failed to estimate gas for ${chain}: ${errorName}: ${errorMessage}`,
        error as Error
      )
    }
  }
}
