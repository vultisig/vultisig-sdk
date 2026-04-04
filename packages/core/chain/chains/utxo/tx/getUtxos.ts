import { ChainAccount } from '../../../ChainAccount'
import { Chain, UtxoChain } from '../../../Chain'
import { getDashUtxos } from '../client/getDashUtxos'
import { getUtxoAddressInfo } from '../client/getUtxoAddressInfo'

import { minUtxo } from '../minUtxo'

import type { ChainPlainUtxo } from './ChainPlainUtxo'

export type { ChainPlainUtxo } from './ChainPlainUtxo'

export const getUtxos = async (
  account: ChainAccount<UtxoChain>
): Promise<ChainPlainUtxo[]> => {
  if (account.chain === Chain.Dash) {
    return getDashUtxos(account.address)
  }

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
