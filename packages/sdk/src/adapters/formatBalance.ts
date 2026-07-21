import { fromChainAmountExact } from '@vultisig/core-chain/amount/fromChainAmountExact'
import { Chain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'

import { Balance, Token } from '../types'

/**
 * Wraps the pure-bigint `fromChainAmountExact` to keep this adapter's legacy
 * display contract: trailing zeros trimmed from the fraction, no fraction
 * part at all for a whole number, and `'0'` for a zero balance regardless of
 * `decimals`. The old hand-rolled version computed the divisor via
 * `BigInt(10 ** decimals)` — a float64 power that's only exact up to
 * decimals=22, silently corrupting output for higher-decimal assets.
 */
function toHumanReadable(rawBalance: bigint, decimals: number): string {
  if (rawBalance === 0n) return '0'

  const [whole, fraction] = fromChainAmountExact(rawBalance, decimals).split('.')
  if (!fraction) return whole

  const trimmed = fraction.replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

export function formatBalance(
  rawBalance: bigint,
  chain: Chain,
  tokenId?: string,
  tokens?: Record<string, Token[]>
): Balance {
  let decimals: number
  let symbol: string

  if (tokenId) {
    const token = tokens?.[chain]?.find(t => t.id === tokenId)
    decimals = token?.decimals ?? 18
    symbol = token?.symbol ?? tokenId
  } else {
    decimals = chainFeeCoin[chain].decimals
    symbol = chainFeeCoin[chain].ticker
  }

  return {
    amount: rawBalance.toString(),
    formattedAmount: toHumanReadable(rawBalance, decimals),
    symbol,
    decimals,
    chainId: chain,
    tokenId,
  }
}
