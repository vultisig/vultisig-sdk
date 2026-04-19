import { stripHexPrefix } from '@vultisig/lib-utils/hex/stripHexPrefix'

import { attempt } from '@vultisig/lib-utils/attempt'

import { cardanoCborEncoder } from './cborEncoder'

/**
 * Decoded shape of a CIP-30 `amount` argument:
 *
 *     value = coin / [coin, multiasset<uint>]
 *
 * We surface `hasAssets` as a boolean rather than a full multiasset tree
 * because the main consumer (`getUtxos` coin selection) only selects by
 * lovelace and falls back to a conservative "return all" when the request
 * also has native-token requirements.
 */
export type CardanoValueRequirement = {
  lovelace: bigint
  hasAssets: boolean
}

const toBigInt = (value: unknown): bigint | null => {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return BigInt(value)
  }
  return null
}

/**
 * Decode a hex-encoded CBOR `value` (per CIP-30 `getUtxos(amount)`).
 *
 * Returns `null` for inputs that fail to decode or don't match the
 * `coin / [coin, multiasset]` shape — callers should treat a null result as
 * "no usable filter" and fall back to returning all UTXOs.
 */
export const decodeCardanoAmountValue = (
  amountHex: string
): CardanoValueRequirement | null => {
  const result = attempt(() => {
    const bytes = Uint8Array.from(
      Buffer.from(stripHexPrefix(amountHex), 'hex')
    )
    if (bytes.length === 0) return null

    const decoded = cardanoCborEncoder.decode(bytes)

    if (Array.isArray(decoded) && decoded.length === 2) {
      const lovelace = toBigInt(decoded[0])
      if (lovelace === null) return null
      const ma = decoded[1]
      const hasAssets =
        ma instanceof Map
          ? ma.size > 0
          : typeof ma === 'object' && ma !== null
            ? Object.keys(ma).length > 0
            : false
      return { lovelace, hasAssets }
    }

    const lovelace = toBigInt(decoded)
    if (lovelace === null) return null
    return { lovelace, hasAssets: false }
  })
  return 'data' in result ? result.data : null
}
