import { ChainAccount } from '../../../ChainAccount'
import { UtxoChain } from '../../../Chain'
import { getUtxoAddressInfo } from '../client/getUtxoAddressInfo'

import { minUtxo } from '../minUtxo'

import type { ChainPlainUtxo } from './ChainPlainUtxo'

export type { ChainPlainUtxo } from './ChainPlainUtxo'

export const getUtxos = async (
  account: ChainAccount<UtxoChain>
): Promise<ChainPlainUtxo[]> => {
  const { data } = await getUtxoAddressInfo(account)

  const { utxo } = data[account.address]

  return utxo
    .filter(({ value }) => value > minUtxo[account.chain])
    .map(({ transaction_hash, value, index }) => ({
      hash: transaction_hash,
      amount: BigInt(value),
      index,
    }))
}
