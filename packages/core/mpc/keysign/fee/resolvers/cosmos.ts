import { Chain } from '@vultisig/core-chain/Chain'
import { getCosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/getCosmosRpcUrl'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { getCosmosChainSpecific } from '../../signingInputs/resolvers/cosmos/chainSpecific'
import { getKeysignChain } from '../../utils/getKeysignChain'
import { FeeAmountResolver } from '../resolver'

type MayaMimir = Record<string, number | string | undefined>

type MayaConstants = {
  int_64_values?: Record<string, number | string | undefined>
}

const parseMayaNativeTransactionFee = (
  value: unknown,
  source: string,
  negativeMeansUnset: boolean
): bigint | undefined => {
  if (value === undefined) return undefined

  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`MayaChain ${source} NativeTransactionFee is not an integer: ${String(value)}`)
  }

  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new Error(`MayaChain ${source} NativeTransactionFee is not a safe integer: ${value}`)
  }

  if (typeof value === 'string' && !/^-?\d+$/.test(value)) {
    throw new Error(`MayaChain ${source} NativeTransactionFee is not an integer: ${value}`)
  }

  const fee = BigInt(value)
  if (negativeMeansUnset && fee < 0n) return undefined

  if (fee < 0n) {
    throw new Error(`MayaChain ${source} NativeTransactionFee must be non-negative: ${value}`)
  }

  return fee
}

const getMayaNativeTransactionFee = async (): Promise<bigint> => {
  const baseUrl = getCosmosRpcUrl(Chain.MayaChain)
  const mimir = await queryUrl<MayaMimir>(`${baseUrl}/mayachain/mimir`)
  const override = parseMayaNativeTransactionFee(mimir.NATIVETRANSACTIONFEE, 'Mimir', true)

  if (override !== undefined) return override

  const constants = await queryUrl<MayaConstants>(`${baseUrl}/mayachain/constants`)
  const defaultFee = parseMayaNativeTransactionFee(constants.int_64_values?.NativeTransactionFee, 'constants', false)

  if (defaultFee === undefined) {
    throw new Error('MayaChain constants response is missing NativeTransactionFee')
  }

  return defaultFee
}

/**
 * Reads the cosmos fee from `blockchainSpecific` where the payload carries it.
 * MayaChain is the intentional exception: its payload schema has no fee field,
 * so the display resolves the current native transaction fee from MayaNode.
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
    vaultBased: value => ('fee' in value ? value.fee : getMayaNativeTransactionFee()),
  })
}
