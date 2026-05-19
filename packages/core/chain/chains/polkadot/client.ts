import { ApiPromise, HttpProvider } from '@polkadot/api'
import { rootApiUrl } from '@vultisig/core-config'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'

export const polkadotRpcUrl = `${rootApiUrl}/dot/`

export const getPolkadotClient = memoizeAsync(() => {
  const provider = new HttpProvider(polkadotRpcUrl)
  return ApiPromise.create({ provider })
})
