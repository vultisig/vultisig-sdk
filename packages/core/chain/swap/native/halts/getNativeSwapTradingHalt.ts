import { Chain } from '@vultisig/core-chain/Chain'
import { getThorchainInboundAddress } from '@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import { withoutDuplicates } from '@vultisig/lib-utils/array/withoutDuplicates'

import { NativeSwapChain, nativeSwapChainIds, nativeSwapEnabledChains } from '../NativeSwapChain'

export type NativeSwapTradingHalt = {
  swapChain: NativeSwapChain
  haltedChains: string[]
  reasons: string[]
}

type NativeSwapTradingHaltDeps = {
  fetchInboundAddresses?: typeof getThorchainInboundAddress
}

type InboundAddresses = Awaited<ReturnType<typeof getThorchainInboundAddress>>
type CacheEntry<T> = { at: number; value: Promise<T> }

const CACHE_TTL_MS = 5_000

let inboundCache: CacheEntry<InboundAddresses> | undefined

const cached = <T>(entry: CacheEntry<T> | undefined, load: () => Promise<T>): CacheEntry<T> => {
  if (entry && Date.now() - entry.at < CACHE_TTL_MS) {
    return entry
  }
  return { at: Date.now(), value: load() }
}

const chainIdFor = (coin: AccountCoin): string | null =>
  isOneOf(coin.chain, nativeSwapEnabledChains) ? nativeSwapChainIds[coin.chain] : null

const getInboundAddresses = async (deps: NativeSwapTradingHaltDeps): Promise<InboundAddresses> => {
  if (deps.fetchInboundAddresses) {
    return deps.fetchInboundAddresses()
  }

  inboundCache = cached(inboundCache, () => {
    const promise = getThorchainInboundAddress()
    promise.catch(() => {
      inboundCache = undefined
    })
    return promise
  })
  return inboundCache.value
}

export const getNativeSwapTradingHalt = async (
  {
    from,
    to,
    swapChain,
  }: {
    from: AccountCoin
    to: AccountCoin
    swapChain: NativeSwapChain
  },
  deps: NativeSwapTradingHaltDeps = {}
): Promise<NativeSwapTradingHalt | null> => {
  if (swapChain !== Chain.THORChain) {
    return null
  }

  const chainIds = withoutDuplicates([chainIdFor(from), chainIdFor(to)].filter((id): id is string => id !== null))
  if (chainIds.length === 0) {
    return null
  }

  try {
    const inbound = await getInboundAddresses(deps)
    const byChain = new Map(inbound.map(info => [info.chain.toUpperCase(), info]))
    const reasons: string[] = []
    const haltedChains = new Set<string>()

    if (inbound.some(info => info.global_trading_paused)) {
      reasons.push('global trading paused')
      haltedChains.add('GLOBAL')
    }

    for (const chainId of chainIds) {
      const info = byChain.get(chainId.toUpperCase())
      if (!info) {
        continue
      }

      if (info.halted) {
        reasons.push(`${info.chain} chain is halted`)
        haltedChains.add(info.chain)
      }

      if (info.chain_trading_paused) {
        reasons.push(`${info.chain} chain trading paused`)
        haltedChains.add(info.chain)
      }

      // Intentionally ignore chain_lp_actions_paused; LP action pauses do not block swaps.
    }

    if (reasons.length === 0) {
      return null
    }

    return {
      swapChain,
      haltedChains: [...haltedChains],
      reasons,
    }
  } catch {
    return null
  }
}
