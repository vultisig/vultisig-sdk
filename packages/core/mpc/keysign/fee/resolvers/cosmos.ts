import { CosmosChain } from '@vultisig/core-chain/Chain'
import { sumFeeAmountForCosmosChainFeeDenom } from '@vultisig/core-chain/chains/cosmos/sumFeeAmountForCosmosChainFeeDenom'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { fromBase64 } from '@cosmjs/encoding'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'
import { AuthInfo } from 'cosmjs-types/cosmos/tx/v1beta1/tx'

import { getCosmosChainSpecific } from '../../signingInputs/resolvers/cosmos/chainSpecific'
import { getKeysignChain } from '../../utils/getKeysignChain'
import { FeeAmountResolver } from '../resolver'

const mayaGas = 2000000000n

const getCosmosFeeFromSignData = (
  keysignPayload: KeysignPayload,
  chain: CosmosChain
): bigint | null => {
  const signData = keysignPayload.signData

  if (signData.case === 'signDirect') {
    const authInfoBytes = fromBase64(signData.value.authInfoBytes)
    const authInfo = AuthInfo.decode(authInfoBytes)
    if (!authInfo.fee?.amount) return null
    return sumFeeAmountForCosmosChainFeeDenom({
      amounts: authInfo.fee.amount,
      chain,
    })
  }

  if (signData.case === 'signAmino') {
    const feeAmounts = signData.value.fee?.amount
    if (!feeAmounts) return null
    return sumFeeAmountForCosmosChainFeeDenom({
      amounts: feeAmounts,
      chain,
    })
  }

  return null
}

export const getCosmosFeeAmount: FeeAmountResolver = ({ keysignPayload }) => {
  const chain = getKeysignChain<'cosmos'>(keysignPayload)

  const chainSpecific = getCosmosChainSpecific(
    chain,
    keysignPayload.blockchainSpecific
  )

  return matchRecordUnion(chainSpecific, {
    ibcEnabled: ({ gas }) => gas,
    vaultBased: value => {
      const feeFromSignData = getCosmosFeeFromSignData(keysignPayload, chain)
      if (feeFromSignData !== null) {
        return feeFromSignData
      }

      if ('fee' in value) {
        return value.fee
      }

      return mayaGas
    },
  })
}
