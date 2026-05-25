import { ApiPromise, HttpProvider } from '@polkadot/api'
import { rootApiUrl } from '@vultisig/core-config'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'

export const polkadotRpcUrl = `${rootApiUrl}/dot/`

// Asset Hub (parachain 1000) — home of pallet_assets USDT/USDC
export const assetHubRpcUrl = `${rootApiUrl}/dot-ah/`

export const getPolkadotClient = memoizeAsync(() => {
  const provider = new HttpProvider(polkadotRpcUrl)
  return ApiPromise.create({ provider })
})
