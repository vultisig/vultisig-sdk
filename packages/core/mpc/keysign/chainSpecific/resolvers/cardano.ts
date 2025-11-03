import { create } from '@bufbuild/protobuf'
import { getCardanoCurrentSlot } from '../../../../chain/chains/cardano/client/currentSlot'
import { cardanoDefaultFee } from '../../../../chain/chains/cardano/config'
import { cardanoSlotOffset } from '../../../../chain/chains/cardano/config'
import { CardanoChainSpecificSchema } from '../../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { bigIntSum } from '../../../../../lib/utils/bigint/bigIntSum'

import { getKeysignAmount } from '../../utils/getKeysignAmount'
import { GetChainSpecificResolver } from '../resolver'

export const getCardanoChainSpecific: GetChainSpecificResolver<
  'cardano'
> = async ({ keysignPayload }) => {
  const amount = getKeysignAmount(keysignPayload)

  const currentSlot = await getCardanoCurrentSlot()
  const ttl = currentSlot + BigInt(cardanoSlotOffset)

  const utxoInfo = keysignPayload.utxoInfo
  const balance = bigIntSum(utxoInfo.map(({ amount }) => amount))
  const sendMaxAmount = amount ? balance === amount : false

  return create(CardanoChainSpecificSchema, {
    ttl,
    sendMaxAmount,
    byteFee: BigInt(cardanoDefaultFee),
  })
}
