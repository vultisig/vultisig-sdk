import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { memoize } from '@vultisig/lib-utils/memoize'

export const getSuiClient = memoize(
  () =>
    new SuiJsonRpcClient({
      url: 'https://sui-rpc.publicnode.com',
      network: 'mainnet',
    })
)
