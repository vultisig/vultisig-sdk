import { toBech32 } from '@cosmjs/encoding'
import { sha256 } from '@noble/hashes/sha2.js'

const qbtcBech32Prefix = 'qbtc'

/** Derives a QBTC address from an MLDSA public key using Bech32(SHA256(pubkey)[:20]). */
export const deriveQbtcAddress = (mldsaPublicKeyHex: string): string => {
  const pubKeyBytes = Buffer.from(mldsaPublicKeyHex, 'hex')
  const hash = sha256(pubKeyBytes).slice(0, 20)
  return toBech32(qbtcBech32Prefix, hash)
}
