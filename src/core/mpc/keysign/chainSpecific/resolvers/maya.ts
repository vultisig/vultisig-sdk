import { create } from '@bufbuild/protobuf'
import { CosmosChain } from '../../../../chain/Chain'
import { getCosmosAccountInfo } from '../../../../chain/chains/cosmos/account/getCosmosAccountInfo'
import {
  MAYAChainSpecific,
  MAYAChainSpecificSchema,
} from '../../../types/vultisig/keysign/v1/blockchain_specific_pb'

import { ChainSpecificResolver } from '../resolver'

export const getMayaSpecific: ChainSpecificResolver<
  MAYAChainSpecific
> = async ({ coin, isDeposit = false }) => {
  const { accountNumber, sequence } = await getCosmosAccountInfo({
    address: coin.address,
    chain: coin.chain as CosmosChain,
  })

  return create(MAYAChainSpecificSchema, {
    accountNumber: BigInt(accountNumber),
    sequence: BigInt(sequence ?? 0),
    isDeposit,
  })
}
