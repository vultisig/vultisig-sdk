import { CoinKey } from '@vultisig/core-chain/coin/Coin'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { EntityWithTicker } from '@vultisig/lib-utils/entities/EntityWithTicker'

import { isFeeCoin } from '../../../coin/utils/isFeeCoin'
import {
  nativeSwapChainIds,
  nativeSwapChains,
  nativeSwapEnabledChains,
} from '../NativeSwapChain'

/** Converts a coin to the asset notation used by THORChain/MayaChain swap APIs */
export const toNativeSwapAsset = ({
  chain,
  id,
  ticker,
}: CoinKey & EntityWithTicker): string => {
  if (!isOneOf(chain, nativeSwapEnabledChains)) {
    throw new Error(`No native swap enabled chain found for ${chain}`)
  }

  if (isFeeCoin({ chain, id })) {
    const swapChainId = nativeSwapChainIds[chain]
    return `${swapChainId}.${ticker}`
  }

  if (isOneOf(chain, nativeSwapChains)) {
    return shouldBePresent(id)
  }

  const swapChainId = nativeSwapChainIds[chain]
  return `${swapChainId}.${ticker}-${id}`
}
