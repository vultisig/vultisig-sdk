import { Chain, UtxoChain } from '../../../Chain'
import { ChainAccount } from '../../../ChainAccount'
import { getDashUtxos } from '../client/getDashUtxos'
import { getUtxoAddressInfo } from '../client/getUtxoAddressInfo'
import { minUtxo } from '../minUtxo'
import type { ChainPlainUtxo } from './ChainPlainUtxo'

export type { ChainPlainUtxo } from './ChainPlainUtxo'

export const getUtxos = async (account: ChainAccount<UtxoChain>): Promise<ChainPlainUtxo[]> => {
  if (account.chain === Chain.Dash) {
    return getDashUtxos(account.address)
  }

  const { data } = await getUtxoAddressInfo(account)

  const { utxo } = data[account.address]

  return utxo
    .filter(
      ({ block_id, is_spendable, value }) => value > minUtxo[account.chain] && is_spendable !== false && block_id > 0
    )
    .map(({ transaction_hash, value, index }) => ({
      hash: transaction_hash,
      amount: BigInt(value),
      index,
    }))
}
