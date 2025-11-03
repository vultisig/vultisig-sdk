import { Chain } from '../../../chain/Chain'
import { ChainAccount } from '../../../chain/ChainAccount'
import { isChainOfKind } from '../../../chain/ChainKind'
import { getCardanoUtxos } from '../../../chain/chains/cardano/utxo/getCardanoUtxos'
import { getUtxos } from '../../../chain/chains/utxo/tx/getUtxos'

export const getKeysignUtxoInfo = async ({ chain, address }: ChainAccount) => {
  if (isChainOfKind(chain, 'utxo')) {
    return getUtxos({ chain, address })
  }

  if (chain === Chain.Cardano) {
    return getCardanoUtxos(address)
  }
}
