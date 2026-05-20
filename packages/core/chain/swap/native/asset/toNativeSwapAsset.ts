import { CoinKey } from '@vultisig/core-chain/coin/Coin'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { EntityWithTicker } from '@vultisig/lib-utils/entities/EntityWithTicker'

import { isFeeCoin } from '../../../coin/utils/isFeeCoin'
import type { NativeSwapChain, NativeSwapChainId } from '../NativeSwapChain'
import { nativeSwapChainIds, nativeSwapChains, nativeSwapEnabledChains } from '../NativeSwapChain'

type NativeSwapDenomChainKey = Lowercase<NativeSwapChainId>

const nativeSwapChainIdValues = Object.values(nativeSwapChainIds) as NativeSwapChainId[]

const securedAssetDenomChainKeyToSwapId = Object.fromEntries(
  nativeSwapChainIdValues.map(swapId => [swapId.toLowerCase() as NativeSwapDenomChainKey, swapId])
) as Partial<Record<NativeSwapDenomChainKey, NativeSwapChainId>>

const getSecuredAssetSwapId = (chainKey: string): NativeSwapChainId | undefined =>
  securedAssetDenomChainKeyToSwapId[chainKey.toLowerCase() as NativeSwapDenomChainKey]

const formatSecuredAssetRest = (rest: string): string => {
  const evmTail = rest.match(/^(.+)-(0x[0-9a-fA-F]+)$/i)
  if (evmTail) {
    return `${evmTail[1].toUpperCase()}-${evmTail[2]}`
  }
  return rest.toUpperCase()
}

const normalizeNativeSwapChainDenom = ({
  chain,
  id,
  ticker,
}: {
  chain: NativeSwapChain
  id: string
} & EntityWithTicker): string => {
  let denom = id
  if (id.startsWith('x/')) {
    const tail = id.slice(2)
    if (!tail.includes('/')) {
      denom = shouldBePresent(tail)
    }
  }

  if (denom.includes('.')) {
    return denom
  }

  const segments = denom.split('-')
  if (segments.length >= 2) {
    const swapId = getSecuredAssetSwapId(segments[0])
    if (swapId) {
      const rest = segments.slice(1).join('-')
      return `${swapId}.${formatSecuredAssetRest(rest)}`
    }
  }

  if (!denom.includes('-') && !denom.includes('/')) {
    const swapChainId = nativeSwapChainIds[chain]
    return `${swapChainId}.${ticker}`
  }

  return id
}

/** Converts a coin to the asset notation used by THORChain/MayaChain swap APIs */
export const toNativeSwapAsset = ({ chain, id, ticker }: CoinKey & EntityWithTicker): string => {
  if (!isOneOf(chain, nativeSwapEnabledChains)) {
    throw new Error(`No native swap enabled chain found for ${chain}`)
  }

  if (isFeeCoin({ chain, id })) {
    const swapChainId = nativeSwapChainIds[chain]
    return `${swapChainId}.${ticker}`
  }

  if (isOneOf(chain, nativeSwapChains)) {
    return normalizeNativeSwapChainDenom({
      chain,
      id: shouldBePresent(id),
      ticker,
    })
  }

  const swapChainId = nativeSwapChainIds[chain]
  return `${swapChainId}.${ticker}-${id}`
}
