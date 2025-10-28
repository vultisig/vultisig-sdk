import { create } from '@bufbuild/protobuf'
import { UtxoChain } from '../../../Chain'
import { ChainAccount } from '../../../ChainAccount'
import { getUtxoAddressInfo } from '../client/getUtxoAddressInfo'
import { UtxoInfoSchema } from '../../../../mpc/types/vultisig/keysign/v1/utxo_info_pb'

import { minUtxo } from '../minUtxo'

export const getUtxos = async (account: ChainAccount<UtxoChain>) => {
  const { data } = await getUtxoAddressInfo(account)

  const { utxo } = data[account.address]

  return utxo
    .filter(({ value }) => value > minUtxo[account.chain])
    .map(({ transaction_hash, value, index }) =>
      create(UtxoInfoSchema, {
        hash: transaction_hash,
        amount: BigInt(value),
        index,
      })
    )
}
