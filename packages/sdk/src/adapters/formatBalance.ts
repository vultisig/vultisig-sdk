import { Chain } from '@core/chain/Chain'
import { chainFeeCoin } from '@core/chain/coin/chainFeeCoin'

import { Balance, Token } from '../types'

export function toHumanReadable(rawBalance: bigint, decimals: number): string {
  if (rawBalance === 0n) return '0'

  const divisor = 10n ** BigInt(decimals)
  const whole = rawBalance / divisor
  const fraction = rawBalance % divisor

  if (fraction === 0n) {
    return whole.toString()
  }

  const fractionStr = fraction.toString().padStart(decimals, '0')
  const trimmed = fractionStr.replace(/0+$/, '')
  return `${whole}.${trimmed}`
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
