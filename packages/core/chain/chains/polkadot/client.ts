import { rootApiUrl } from '@vultisig/core-config'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'

// Polkadot Asset Hub (parachain 1000, specName `statemint`). Since the Asset Hub
// migration, native DOT balances, transfers and fees live on Asset Hub, and the
// `/dot/` proxy serves it rather than the relay chain.
export const polkadotRpcUrl = `${rootApiUrl}/dot/`

// pallet_assets (USDT id=1984, USDC id=1337) lives on the same chain as native
// DOT, so token reads go through the same endpoint. The old `/dot-ah/` proxy
// returns 404.
export const assetHubRpcUrl = polkadotRpcUrl

/**
 * Returns a client for Polkadot Asset Hub, the chain that holds native DOT
 * balances and accepts DOT transfers.
 */
export const getPolkadotClient = memoizeAsync(async () => {
  const { ApiPromise, HttpProvider } = await import('@polkadot/api')
  const provider = new HttpProvider(polkadotRpcUrl)
  return ApiPromise.create({ provider })
})
