import { CosmosChain } from '@vultisig/core-chain/Chain'
import { cosmosFeeCoinDenom } from '@vultisig/core-chain/chains/cosmos/cosmosFeeCoinDenom'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import { getKeysignCoin } from '../../../utils/getKeysignCoin'

export const getCosmosCoinAmount = (input: KeysignPayload) => {
  const coin = getKeysignCoin<CosmosChain>(input)

  const denom = isFeeCoin(coin)
    ? cosmosFeeCoinDenom[coin.chain as CosmosChain]
    : coin.id

  return {
    amount: input.toAmount,
    denom,
  }
}
