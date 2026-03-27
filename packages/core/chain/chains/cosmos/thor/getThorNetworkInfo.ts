import { Chain } from '@vultisig/core-chain/Chain'
import { cosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

type NetworkInfo = {
  native_tx_fee_rune: string
}

export const getThorNetworkInfo = async () =>
  queryUrl<NetworkInfo>(`${cosmosRpcUrl[Chain.THORChain]}/thorchain/network`)
