import { OtherChain } from '@vultisig/core-chain/Chain'
import { blake2b } from '@noble/hashes/blake2b'
import { decode, encode } from 'cbor-x'

import { TxHashResolver } from '../resolver'

export const getCardanoTxHash: TxHashResolver<OtherChain.Cardano> = tx => {
  // Prefer pre-computed txId (set by compileTx to avoid cbor-x
  // re-encoding which can alter byte representation).
  if (tx.txId && tx.txId.length > 0) {
    return Buffer.from(tx.txId).toString('hex')
  }

  const decoded = decode(tx.encoded)
  const bodyCbor = encode(decoded[0])
  const digest = blake2b(bodyCbor, { dkLen: 32 })

  return Buffer.from(digest).toString('hex')
}
