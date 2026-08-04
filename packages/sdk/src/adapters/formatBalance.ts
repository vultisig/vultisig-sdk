import { fromChainAmountExact } from '@vultisig/core-chain/amount/fromChainAmountExact'
import { Chain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'

import { Balance, Token } from '../types'
import { type ResolvedTokenInfo, resolveTokenRef } from '../vault/tokenRef'

/** Resolve for display only: an unknown id is not an error here, just unlabelled. */
function resolveTokenRefSafe(chain: Chain, tokenId: string, tokens: Token[]): ResolvedTokenInfo | undefined {
  try {
    return resolveTokenRef(chain, tokenId, tokens)
  } catch {
    return undefined
  }
}

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
    // Resolve through the shared token-ref resolver rather than an exact
    // `t.id === tokenId` match. The id a balance is fetched under is not always
    // the id it is stored under — `tokens --add` writes `id: '<Chain>-<addr>'`
    // while the RPC layer is keyed by the bare contract address, and a
    // well-known token need not be in the vault's list at all. An exact match
    // missed both, and the fallback below then formatted the balance at 18
    // decimals and labelled it with the raw contract address: 6.624295 USDC
    // rendered as "0.000000000006624295 0xA0b86991…", which also tripped the
    // CLI's insufficient-balance warning.
    const token = resolveTokenRefSafe(chain, tokenId, tokens?.[chain] ?? [])
    decimals = token?.decimals ?? 18
    symbol = token?.ticker ?? tokenId
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
