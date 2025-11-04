import { create } from '@bufbuild/protobuf'
import { CosmosChain } from '../../../../chain/Chain'
import { getCosmosAccountInfo } from '../../../../chain/chains/cosmos/account/getCosmosAccountInfo'
import { getThorNetworkInfo } from '../../../../chain/chains/cosmos/thor/getThorNetworkInfo'
import { THORChainSpecificSchema } from '../../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { TransactionType } from '../../../types/vultisig/keysign/v1/blockchain_specific_pb'

import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../resolver'

export const getThorchainChainSpecific: GetChainSpecificResolver<
  'thorchainSpecific'
> = async ({
  keysignPayload,
  transactionType = TransactionType.UNSPECIFIED,
  isDeposit,
}) => {
  const coin = getKeysignCoin<CosmosChain>(keysignPayload)
  const { accountNumber, sequence } = await getCosmosAccountInfo(coin)
  const { native_tx_fee_rune } = await getThorNetworkInfo()

  return create(THORChainSpecificSchema, {
    accountNumber: BigInt(accountNumber),
    sequence: BigInt(sequence),
    transactionType,
    fee: BigInt(native_tx_fee_rune),
    isDeposit,
  })
}
