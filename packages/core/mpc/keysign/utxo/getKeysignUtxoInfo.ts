import { Chain } from '@vultisig/core-chain/Chain'
import { ChainAccount } from '@vultisig/core-chain/ChainAccount'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { getCardanoUtxos } from '@vultisig/core-chain/chains/cardano/utxo/getCardanoUtxos'
import { getUtxos } from '@vultisig/core-chain/chains/utxo/tx/getUtxos'

export const getKeysignUtxoInfo = async ({ chain, address }: ChainAccount) => {
  if (isChainOfKind(chain, 'utxo')) {
    return getUtxos({ chain, address })
  }

  if (chain === Chain.Cardano) {
    return getCardanoUtxos(address)
  }
}
