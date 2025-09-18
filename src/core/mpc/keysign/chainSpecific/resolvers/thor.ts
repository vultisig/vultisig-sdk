import { create } from '@bufbuild/protobuf'
import { CosmosChain } from '../../../../chain/Chain'
import { getCosmosAccountInfo } from '../../../../chain/chains/cosmos/account/getCosmosAccountInfo'
import { getThorNetworkInfo } from '../../../../chain/chains/cosmos/thor/getThorNetworkInfo'
import {
  THORChainSpecific,
  THORChainSpecificSchema,
  TransactionType,
} from '../../../types/vultisig/keysign/v1/blockchain_specific_pb'

import { ChainSpecificResolver } from '../resolver'

export const getThorchainSpecific: ChainSpecificResolver<
  THORChainSpecific
> = async ({
  coin,
  isDeposit = false,
  transactionType = TransactionType.UNSPECIFIED,
}) => {
  const { accountNumber, sequence } = await getCosmosAccountInfo({
    address: coin.address,
    chain: coin.chain as CosmosChain,
  })

  const { native_tx_fee_rune } = await getThorNetworkInfo()

  const thorchainSpecific = create(THORChainSpecificSchema, {
    accountNumber: BigInt(accountNumber),
    sequence: BigInt(sequence ?? 0),
    fee: BigInt(native_tx_fee_rune),
    isDeposit,
    transactionType,
  })

  return thorchainSpecific
}
