import { Chain } from '@core/chain/Chain'
import { chainFeeCoin } from '@core/chain/coin/chainFeeCoin'
import { Balance, Token } from '../types'

/**
 * Convert raw bigint balance to SDK Balance format
 *
 * This adapter bridges between core's bigint balance values and SDK's
 * structured Balance type with metadata.
 *
 * @param rawBalance Raw balance as bigint from core
 * @param chain Chain identifier
 * @param tokenId Optional token contract address/identifier
 * @param tokens Optional token registry for looking up token metadata
 * @returns Formatted Balance object
 */
export function formatBalance(
  rawBalance: bigint,
  chain: string,
  tokenId?: string,
  tokens?: Record<string, Token[]>
): Balance {
  let decimals: number
  let symbol: string

  if (tokenId) {
    // Token balance - look up metadata from token registry
    const token = tokens?.[chain]?.find(t => t.id === tokenId)
    decimals = token?.decimals ?? 18 // Default to 18 for ERC-20 tokens
    symbol = token?.symbol ?? tokenId
  } else {
    // Native balance - use chainFeeCoin
    decimals = chainFeeCoin[chain as Chain].decimals
    symbol = chainFeeCoin[chain as Chain].ticker
  }

  return {
    amount: rawBalance.toString(),
    symbol,
    decimals,
    chainId: chain,
    tokenId
  }
}
