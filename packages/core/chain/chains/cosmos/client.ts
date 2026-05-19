import { StargateClient } from '@cosmjs/stargate'
import { CosmosChain } from '@vultisig/core-chain/Chain'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'

import { tendermintRpcUrl } from './tendermintRpcUrl'

export const getCosmosClient = memoizeAsync(async (chain: CosmosChain) =>
  StargateClient.connect(tendermintRpcUrl[chain])
)
