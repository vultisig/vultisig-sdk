import { getUtxos } from '../../../../chain/chains/utxo/tx/getUtxos'
import { getCoinBalance } from '../../../../chain/coin/balance'

import { KeysignTxDataResolver } from '../resolver'

const dustStats = 600n

export const getUtxoTxData: KeysignTxDataResolver<'utxo'> = async ({
  coin,
  amount,
  psbt,
}) => {
  const utxoInfo = await getUtxos(coin)

  return {
    psbt: psbt?.toBase64(),
    utxoInfo,
    sendMaxAmount: amount
      ? (await getCoinBalance(coin)) - amount <= dustStats
      : false,
  }
}
