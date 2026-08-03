import { blake2b } from '@noble/hashes/blake2b'
import { OtherChain } from '@vultisig/core-chain/Chain'
import { cardanoCborEncoder } from '@vultisig/core-chain/chains/cardano/cip30/cborEncoder'

import { TxHashResolver } from '../resolver'

export const getCardanoTxHash: TxHashResolver<OtherChain.Cardano> = tx => {
  // Prefer pre-computed txId (set by compileTx to avoid cbor-x
  // re-encoding which can alter byte representation).
  if (tx.txId && tx.txId.length > 0) {
    return Buffer.from(tx.txId).toString('hex')
  }

  // Fallback decode must go through cardanoCborEncoder (maps stay `Map`):
  // token-carrying txs have byte-string map keys that cbor-x's default
  // decode-to-object rejects with "Invalid property name type object".
  const decoded = cardanoCborEncoder.decode(tx.encoded)
  const bodyCbor = cardanoCborEncoder.encode(decoded[0])
  const digest = blake2b(bodyCbor, { dkLen: 32 })

  return Buffer.from(digest).toString('hex')
}
