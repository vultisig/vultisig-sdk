import { create } from '@bufbuild/protobuf'
import { CosmosChain } from '../../../../chain/Chain'
import { getCosmosAccountInfo } from '../../../../chain/chains/cosmos/account/getCosmosAccountInfo'
import { MAYAChainSpecificSchema } from '../../../types/vultisig/keysign/v1/blockchain_specific_pb'

import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../resolver'

export const getMayaChainSpecific: GetChainSpecificResolver<
  'mayaSpecific'
> = async ({ keysignPayload, isDeposit }) => {
  const coin = getKeysignCoin<CosmosChain>(keysignPayload)
  const { accountNumber, sequence } = await getCosmosAccountInfo(coin)

  return create(MAYAChainSpecificSchema, {
    accountNumber: BigInt(accountNumber),
    sequence: BigInt(sequence),
    isDeposit,
  })
}
