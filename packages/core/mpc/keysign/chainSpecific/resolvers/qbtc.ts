import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { getQbtcAccountInfo } from '@vultisig/core-chain/chains/cosmos/qbtc/getQbtcAccountInfo'
import {
  CosmosSpecificSchema,
  TransactionType,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'

import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { GetChainSpecificResolver } from '../resolver'

const qbtcDefaultGas = 7500n

export const getQbtcChainSpecific: GetChainSpecificResolver<
  'cosmosSpecific'
> = async ({
  keysignPayload,
  transactionType = TransactionType.UNSPECIFIED,
  timeoutTimestamp,
}) => {
  const coin = getKeysignCoin<typeof Chain.QBTC>(keysignPayload)
  const { accountNumber, sequence, latestBlock } = await getQbtcAccountInfo({
    address: coin.address,
  })

  return create(CosmosSpecificSchema, {
    accountNumber: BigInt(accountNumber),
    sequence: BigInt(sequence),
    transactionType,
    gas: qbtcDefaultGas,
    ibcDenomTraces: {
      latestBlock: timeoutTimestamp
        ? `${latestBlock.split('_')[0]}_${timeoutTimestamp}`
        : latestBlock,
      baseDenom: '',
      path: '',
    },
  })
}
