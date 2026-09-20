import { rootApiUrl } from '@vultisig/core-config'

export const polkadotRpcUrl = `${rootApiUrl}/dot/`

// Asset Hub (parachain 1000) — home of pallet_assets USDT/USDC
export const assetHubRpcUrl = `${rootApiUrl}/dot-ah/`

export const polkadotConfig = {
  fee: BigInt(250000000),
}
