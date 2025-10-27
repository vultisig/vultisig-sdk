import { getCardanoCurrentSlot } from '../../../../chain/chains/cardano/client/currentSlot'
import { cardanoSlotOffset } from '../../../../chain/chains/cardano/config'
import { getCardanoUtxos } from '../../../../chain/chains/cardano/utxo/getCardanoUtxos'
import { getCoinBalance } from '../../../../chain/coin/balance'

import { KeysignTxDataResolver } from '../resolver'

export const getCardanoTxData: KeysignTxDataResolver<'cardano'> = async ({
  coin,
  amount,
}) => {
  const currentSlot = await getCardanoCurrentSlot()
  const ttl = currentSlot + BigInt(cardanoSlotOffset)

  const utxoInfo = await getCardanoUtxos(coin.address)

  return {
    ttl,
    utxoInfo,
    sendMaxAmount: amount ? (await getCoinBalance(coin)) === amount : false,
  }
}
