import { CosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosGasLimit } from '@vultisig/core-chain/chains/cosmos/cosmosGasLimitRecord'
import { resolveCosmosGasFee } from '@vultisig/core-chain/chains/cosmos/resolveCosmosGasFee'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'

import { getCosmosChainSpecific } from '../../signingInputs/resolvers/cosmos/chainSpecific'
import { getKeysignChain } from '../../utils/getKeysignChain'
import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { FeeAmountResolver } from '../resolver'

const mayaGas = 2000000000n

/**
 * Reads the cosmos fee from `blockchainSpecific`. Initiators are responsible
 * for writing the canonical fee (e.g. the dapp-supplied value when signing
 * via signAmino / signDirect) into `THORChainSpecific.fee` /
 * `CosmosSpecific.gas` at keysign-payload build time, so every consumer —
 * including this resolver — agrees on what the chain will charge.
 *
 * When a dynamic `CosmosSpecific.gas_limit` is relayed, the displayed fee is
 * scaled by the same rule the signing-inputs resolver applies, so the Network
 * Fee row matches what the chain actually charges.
 */
export const getCosmosFeeAmount: FeeAmountResolver = ({ keysignPayload }) => {
  const chain = getKeysignChain<'cosmos'>(keysignPayload)

  const chainSpecific = getCosmosChainSpecific(chain, keysignPayload.blockchainSpecific)

  return matchRecordUnion(chainSpecific, {
    ibcEnabled: ({ gas, gasLimit }) => {
      const coin = getKeysignCoin<CosmosChain>(keysignPayload)
      const { feeAmount } = resolveCosmosGasFee({
        gas,
        relayedGasLimit: gasLimit,
        staticGasLimit: getCosmosGasLimit(coin),
      })
      return feeAmount
    },
    vaultBased: value => ('fee' in value ? value.fee : mayaGas),
  })
}
