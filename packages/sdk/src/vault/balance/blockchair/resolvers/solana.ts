/**
 * Blockchair Solana Balance Resolver
 * Uses Blockchair API for Solana balance queries
 */

import { getSplAccounts } from '@core/chain/chains/solana/spl/getSplAccounts'
import { CoinBalanceResolver } from '@core/chain/coin/balance/resolver'
import { isFeeCoin } from '@core/chain/coin/utils/isFeeCoin'

import { blockchairClient } from '../index'

/**
 * Blockchair-based Solana balance resolver
 * Provides balance information using Blockchair's indexed data
 */
export const getBlockchairSolanaCoinBalance: CoinBalanceResolver =
  async input => {
    try {
      if (isFeeCoin(input)) {
        // Native SOL balance
        const addressData = await blockchairClient.getAddressInfo(
          'solana',
          input.address
        )

        // Blockchair returns SOL balance as string in lamports
        const balanceLamports = (addressData as any).address?.balance
        if (!balanceLamports) {
          return 0n
        }

        // Convert lamports string to BigInt
        return BigInt(balanceLamports)
      } else {
        // SPL token balance - fallback to existing resolver
        // Blockchair's Solana SPL token support may be limited
        const accounts = await getSplAccounts(input.address)

        const tokenAccount = accounts.find(
          account => account.account.data.parsed.info.mint === input.id
        )

        const tokenAmount =
          tokenAccount?.account?.data?.parsed?.info?.tokenAmount?.amount

        return BigInt(tokenAmount ?? 0)
      }
    } catch (error) {
      console.warn(
        `Blockchair Solana balance fetch failed for ${input.address}:`,
        error
      )

      // Fallback to original Solana client for native tokens
      if (isFeeCoin(input)) {
        const { getSolanaClient } = await import('@core/chain/chains/solana/client')
        const client = await getSolanaClient()
        const balance = await client.getBalance(new (await import('@solana/web3.js')).PublicKey(input.address))
        return BigInt(balance)
      }

      // For tokens, re-throw the error
      throw error
    }
  }
