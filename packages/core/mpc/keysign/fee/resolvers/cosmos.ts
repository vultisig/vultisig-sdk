import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'

import { getCosmosChainSpecific } from '../../signingInputs/resolvers/cosmos/chainSpecific'
import { getKeysignChain } from '../../utils/getKeysignChain'
import { FeeAmountResolver } from '../resolver'

const mayaGas = 2000000000n

/**
 * Reads the cosmos fee from `blockchainSpecific`. Initiators are responsible
 * for writing the canonical fee (e.g. the dapp-supplied value when signing
 * via signAmino / signDirect) into `THORChainSpecific.fee` /
 * `CosmosSpecific.gas` at keysign-payload build time, so every consumer —
 * including this resolver — agrees on what the chain will charge.
 */
export const getCosmosFeeAmount: FeeAmountResolver = ({ keysignPayload }) => {
  const chain = getKeysignChain<'cosmos'>(keysignPayload)

  const chainSpecific = getCosmosChainSpecific(chain, keysignPayload.blockchainSpecific)

  return matchRecordUnion(chainSpecific, {
    ibcEnabled: ({ gas }) => gas,
    vaultBased: value => ('fee' in value ? value.fee : mayaGas),
  })
}
