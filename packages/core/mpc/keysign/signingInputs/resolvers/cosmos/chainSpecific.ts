import { CosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosChainKind } from '@vultisig/core-chain/chains/cosmos/utils/getCosmosChainKind'
import {
  CosmosSpecific,
  MAYAChainSpecific,
  THORChainSpecific,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import {
  chainSpecificRecord,
  getBlockchainSpecificValue,
} from '../../../chainSpecific/KeysignChainSpecific'

export type CosmosChainSpecific =
  | {
      ibcEnabled: CosmosSpecific
    }
  | { vaultBased: THORChainSpecific | MAYAChainSpecific }

export const getCosmosChainSpecific = (
  chain: CosmosChain,
  blockchainSpecific: KeysignPayload['blockchainSpecific']
) => {
  const chainKind = getCosmosChainKind(chain)

  return {
    [chainKind]: getBlockchainSpecificValue(
      blockchainSpecific,
      chainSpecificRecord[chain]
    ),
  } as CosmosChainSpecific
}
