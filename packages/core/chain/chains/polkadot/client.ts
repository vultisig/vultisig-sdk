import { ApiPromise, HttpProvider } from '@polkadot/api'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'

import { polkadotRpcUrl } from './config'

export { assetHubRpcUrl, polkadotRpcUrl } from './config'

/**
 * Returns the Polkadot RELAY CHAIN client (NOT Asset Hub).
 * For Asset Hub queries (e.g. pallet_assets), use assetHubRpcUrl directly
 * via the getAssetHubTokenBalance resolver instead.
 */
export const getPolkadotClient = memoizeAsync(() => {
  const provider = new HttpProvider(polkadotRpcUrl)
  return ApiPromise.create({ provider })
})
