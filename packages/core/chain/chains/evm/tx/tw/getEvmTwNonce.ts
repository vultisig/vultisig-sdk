import { bigIntToHex } from '@vultisig/lib-utils/bigint/bigIntToHex'
import { stripHexPrefix } from '@vultisig/lib-utils/hex/stripHexPrefix'

export const getEvmTwNonce = (nonce: bigint) => {
  return Buffer.from(stripHexPrefix(bigIntToHex(nonce).padStart(2, '0')), 'hex')
}
