import { ApiPromise, HttpProvider } from '@polkadot/api'
import { rootApiUrl } from '@vultisig/core-config'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'

export const polkadotRpcUrl = `${rootApiUrl}/dot/`

// Asset Hub (parachain 1000) — home of pallet_assets USDT/USDC
export const assetHubRpcUrl = `${rootApiUrl}/dot-ah/`

/**
 * Returns the Polkadot RELAY CHAIN client (NOT Asset Hub).
 * For Asset Hub queries (e.g. pallet_assets), use assetHubRpcUrl directly
 * via the getAssetHubTokenBalance resolver instead.
 */
export const getPolkadotClient = memoizeAsync(() => {
  const provider = new HttpProvider(polkadotRpcUrl)
  return ApiPromise.create({ provider })
})
