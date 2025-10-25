/**
 * Blockchair EVM Balance Resolver
 * Uses Blockchair API for EVM chain balance queries
 */

import { EvmChain } from '../../../../core/chain/Chain'
import { getErc20Balance } from '../../../../core/chain/chains/evm/erc20/getErc20Balance'
import { CoinBalanceResolver } from '../../../../core/chain/coin/balance/resolver'
import { isFeeCoin } from '../../../../core/chain/coin/utils/isFeeCoin'

import { BlockchairChain, blockchairClient } from '../index'

/**
 * Map Vultisig EVM chain names to Blockchair chain names
 * Only includes chains that Blockchair supports
 */
const CHAIN_MAPPING: Partial<Record<EvmChain, BlockchairChain>> = {
  [EvmChain.Ethereum]: 'ethereum',
  [EvmChain.Base]: 'base',
  [EvmChain.Arbitrum]: 'arbitrum',
  [EvmChain.Polygon]: 'polygon',
  [EvmChain.Optimism]: 'optimism',
  [EvmChain.CronosChain]: 'cronos',
  [EvmChain.Blast]: 'blast',
  [EvmChain.BSC]: 'bsc',
  [EvmChain.Zksync]: 'zksync',
  [EvmChain.Avalanche]: 'avalanche',
  [EvmChain.Mantle]: 'mantle',
}

/**
 * Blockchair-based EVM balance resolver
 * Provides balance information using Blockchair's indexed data
 */
export const getBlockchairEvmCoinBalance: CoinBalanceResolver<
  EvmChain
> = async input => {
  const chain = input.chain

  // Check if we have a Blockchair mapping for this chain
  const blockchairChain = CHAIN_MAPPING[chain]
  if (!blockchairChain) {
    throw new Error(`Blockchair does not support chain: ${chain}`)
  }

  try {
    if (isFeeCoin(input)) {
      // Native token balance (ETH, BNB, MATIC, etc.)
      const addressData = await blockchairClient.getAddressInfo(
        blockchairChain,
        input.address
      )

      // For EVM chains, Blockchair returns balance as string in Wei
      const balanceWei = (addressData as any).address?.balance
      if (!balanceWei) {
        return 0n
      }

      // Convert Wei string to BigInt
      return BigInt(balanceWei)
    } else {
      // ERC-20 token balance - fallback to existing resolver
      // Blockchair doesn't provide comprehensive ERC-20 balance data
      // so we use the existing ERC-20 balance resolver
      const tokenBalance = await getErc20Balance({
        chain,
        address: input.id as `0x${string}`,
        accountAddress: input.address as `0x${string}`,
      })

      return tokenBalance
    }
  } catch (error) {
    console.warn(
      `Blockchair EVM balance fetch failed for ${chain}:${input.address}:`,
      error
    )

    // Fallback to original resolver for native tokens
    if (isFeeCoin(input)) {
      const { getEvmClient } = await import('../../../../core/chain/chains/evm/client')
      const balance = await getEvmClient(chain).getBalance({
        address: input.address as `0x${string}`,
      })
      return BigInt(balance)
    }

    // For tokens, re-throw the error
    throw error
  }
}
