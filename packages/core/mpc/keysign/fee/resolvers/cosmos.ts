import { CosmosChain } from '@vultisig/core-chain/Chain'
import { MAYA_SEND_FEE_BASE_UNITS } from '@vultisig/core-chain/chains/cosmos/gas'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'

import { getCosmosChainSpecific, getCosmosFeeAmounts } from '../../signingInputs/resolvers/cosmos/chainSpecific'
import { getKeysignChain } from '../../utils/getKeysignChain'
import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { FeeAmountResolver } from '../resolver'

/**
 * Reads the cosmos fee from `blockchainSpecific`. Initiators are responsible
 * for writing the canonical fee (e.g. the dapp-supplied value when signing
 * via signAmino / signDirect) into `THORChainSpecific.fee` /
 * `CosmosSpecific.gas` at keysign-payload build time, so every consumer —
 * including this resolver — agrees on what the chain will charge.
 *
 * `CosmosSpecific.gas` is the base fee AMOUNT (proto field 3). A relayed
 * `gas_limit` (field 7) changes the signed gas limit, not the amount; the
 * initiator has already priced `gas` against it. TerraClassic USTC sends also
 * sign the pre-computed `uusd` burn-tax surcharge as a second amount, so the
 * display total is the sum of the same fee-amount list used by signing.
 */
export const getCosmosFeeAmount: FeeAmountResolver = ({ keysignPayload }) => {
  const chain = getKeysignChain<'cosmos'>(keysignPayload)
  const coin = getKeysignCoin<CosmosChain>(keysignPayload)

  const chainSpecific = getCosmosChainSpecific(chain, keysignPayload.blockchainSpecific)

  return matchRecordUnion(chainSpecific, {
    ibcEnabled: cosmosSpecific =>
      getCosmosFeeAmounts({
        chain,
        coinId: coin.id,
        chainSpecific: cosmosSpecific,
        // signAmino/signDirect carry their own fee list. Their canonical base
        // total is already relayed in `gas`; the native USTC surcharge applies
        // only to the ordinary signing-input path.
        includeTerraClassicBurnTax: keysignPayload.signData.case === undefined,
      }).reduce((total, { amount }) => total + amount, 0n),
    vaultBased: value => ('fee' in value ? value.fee : MAYA_SEND_FEE_BASE_UNITS),
  })
}
