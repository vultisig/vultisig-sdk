import { Chain } from '../../../Chain'
import { cosmosRpcUrl } from '../cosmosRpcUrl'
import { queryUrl } from '../../../../../lib/utils/query/queryUrl'

type NetworkInfo = {
  native_tx_fee_rune: string
}

export const getThorNetworkInfo = async () =>
  queryUrl<NetworkInfo>(`${cosmosRpcUrl[Chain.THORChain]}/thorchain/network`)
