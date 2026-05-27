import { create } from '@bufbuild/protobuf'
import { getCardanoCurrentSlot } from '@vultisig/core-chain/chains/cardano/client/currentSlot'
import { cardanoDefaultFee } from '@vultisig/core-chain/chains/cardano/config'
import { cardanoSlotOffset } from '@vultisig/core-chain/chains/cardano/config'
import { CardanoChainSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { bigIntSum } from '@vultisig/lib-utils/bigint/bigIntSum'

import { buildCip20AuxData } from '../../../tx/compile/cardano/buildCip20AuxData'
import { getKeysignAmount } from '../../utils/getKeysignAmount'
import { GetChainSpecificResolver } from '../resolver'

// Cardano fee formula: fee = a * txBytes + b (mainnet params)
const CARDANO_A_PARAM = BigInt(44)

export const getCardanoChainSpecific: GetChainSpecificResolver<'cardano'> = async ({ keysignPayload }) => {
  const amount = getKeysignAmount(keysignPayload)

  const currentSlot = await getCardanoCurrentSlot()
  const ttl = currentSlot + BigInt(cardanoSlotOffset)

  const utxoInfo = keysignPayload.utxoInfo
  const balance = bigIntSum(utxoInfo.map(({ amount }) => amount))
  const sendMaxAmount = amount ? balance === amount : false

  // When a memo is present, CIP-20 aux data is appended to the final tx.
  // WalletCore does not know about this extra payload, so we bump the forced
  // fee by a * len(auxDataCbor) to prevent a "fee too small" rejection.
  let byteFee = BigInt(cardanoDefaultFee)
  if (keysignPayload.memo) {
    const { auxDataCbor } = buildCip20AuxData(keysignPayload.memo)
    byteFee += CARDANO_A_PARAM * BigInt(auxDataCbor.length)
  }

  return create(CardanoChainSpecificSchema, {
    ttl,
    sendMaxAmount,
    byteFee,
  })
}
