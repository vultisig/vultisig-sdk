import { MAYA_SEND_FEE_BASE_UNITS } from '@vultisig/core-chain/chains/cosmos/gas'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'

import { getCosmosChainSpecific } from '../../signingInputs/resolvers/cosmos/chainSpecific'
import { getKeysignChain } from '../../utils/getKeysignChain'
import { FeeAmountResolver } from '../resolver'

/**
 * Reads the cosmos fee from `blockchainSpecific`. Initiators are responsible
 * for writing the canonical fee (e.g. the dapp-supplied value when signing
 * via signAmino / signDirect) into `THORChainSpecific.fee` /
 * `CosmosSpecific.gas` at keysign-payload build time, so every consumer —
 * including this resolver — agrees on what the chain will charge.
 *
 * `CosmosSpecific.gas` is the fee AMOUNT (proto field 3) and is returned
 * verbatim — exactly what the signing-inputs resolver puts in the SignDoc, so
 * the Network Fee row can never drift from what gets signed. A relayed
 * `gas_limit` (field 7) changes the signed gas limit, not the amount; the
 * initiator has already priced `gas` against it.
 */
export const getCosmosFeeAmount: FeeAmountResolver = ({ keysignPayload }) => {
  const chain = getKeysignChain<'cosmos'>(keysignPayload)

  const chainSpecific = getCosmosChainSpecific(chain, keysignPayload.blockchainSpecific)

  return matchRecordUnion(chainSpecific, {
    ibcEnabled: ({ gas }) => gas,
    vaultBased: value => ('fee' in value ? value.fee : MAYA_SEND_FEE_BASE_UNITS),
  })
}
