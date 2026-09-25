import { UtxoChain } from '@vultisig/core-chain/Chain'

import { TxHashResolver } from '../resolver'

export const getUtxoTxHash: TxHashResolver<UtxoChain> = ({ transactionId, signingResultV2 }) => {
  if (signingResultV2?.txid && signingResultV2.txid.length > 0) {
    return Buffer.from(signingResultV2.txid).reverse().toString('hex')
  }
  return transactionId
}
