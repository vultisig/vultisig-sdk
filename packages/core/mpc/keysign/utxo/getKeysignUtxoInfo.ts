import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { ChainAccount } from '@vultisig/core-chain/ChainAccount'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { getCardanoUtxos } from '@vultisig/core-chain/chains/cardano/utxo/getCardanoUtxos'
import { getUtxos } from '@vultisig/core-chain/chains/utxo/tx/getUtxos'

import { UtxoInfoSchema } from '../../types/vultisig/keysign/v1/utxo_info_pb'

const toUtxoInfo = (plain: {
  hash: string
  amount: bigint
  index: number
}) =>
  create(UtxoInfoSchema, {
    hash: plain.hash,
    amount: plain.amount,
    index: plain.index,
  })

export const getKeysignUtxoInfo = async ({ chain, address }: ChainAccount) => {
  if (isChainOfKind(chain, 'utxo')) {
    const plain = await getUtxos({ chain, address })
    return plain.map(toUtxoInfo)
  }

  if (chain === Chain.Cardano) {
    const plain = await getCardanoUtxos(address)
    return plain.map(toUtxoInfo)
  }
}
