/**
 * Blockchair Cardano Balance Resolver
 * Uses Blockchair API for Cardano balance queries
 */

import { CoinBalanceResolver } from '../../../../core/chain/coin/balance/resolver'
import { isFeeCoin } from '../../../../core/chain/coin/utils/isFeeCoin'

import { blockchairClient } from '../index'

/**
 * Blockchair-based Cardano balance resolver
 * Provides balance information using Blockchair's indexed data
 */
export const getBlockchairCardanoCoinBalance: CoinBalanceResolver =
  async input => {
    try {
      if (isFeeCoin(input)) {
        // Native ADA balance
        const addressData = await blockchairClient.getAddressInfo(
          'cardano',
          input.address
        )

        // Blockchair returns ADA balance as string in lovelace
        const balanceLovelace = (addressData as any).address?.balance
        if (!balanceLovelace) {
          return 0n
        }

        // Convert lovelace string to BigInt
        return BigInt(balanceLovelace)
      } else {
        // Cardano native assets/tokens
        // For now, return 0 as Blockchair's Cardano token support may be limited
        console.warn(
          `Blockchair Cardano token balance not yet implemented for ${input.id}`
        )
        return 0n
      }
    } catch (error) {
      console.warn(
        `Blockchair Cardano balance fetch failed for ${input.address}:`,
        error
      )

      // For Cardano, we don't have a direct fallback resolver in the current codebase
      // Return 0 for now - this would need to be enhanced with a Cardano-specific client
      return 0n
    }
  }
