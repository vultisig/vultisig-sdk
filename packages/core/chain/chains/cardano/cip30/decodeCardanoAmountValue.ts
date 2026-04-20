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

const hexPattern = /^[0-9a-fA-F]*$/

/** Cardano coin is always a non-negative uint — reject anything else. */
const toBigInt = (value: unknown): bigint | null => {
  if (typeof value === 'bigint') return value >= 0n ? value : null
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return BigInt(value)
  }
  return null
}

/**
 * A valid multiasset is a CBOR map:
 *
 *     multiasset<a> = { * policy_id => { * asset_name => a } }
 *
 * cbor-x decodes this as a `Map` (because we set `mapsAsObjects: false`), but
 * we accept a plain non-array object too for robustness against inputs that
 * went through a re-encode pass elsewhere. Arrays and scalars are rejected.
 */
const isMultiassetShape = (value: unknown): boolean =>
  value instanceof Map ||
  (typeof value === 'object' && value !== null && !Array.isArray(value))

const multiassetHasEntries = (value: unknown): boolean => {
  if (value instanceof Map) return value.size > 0
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.keys(value).length > 0
  }
  return false
}

/**
 * Decode a hex-encoded CBOR `value` (per CIP-30 `getUtxos(amount)`).
 *
 * Returns `null` for inputs that fail to decode or don't match the
 * `coin / [coin, multiasset]` shape — callers should treat a null result as
 * "no usable filter" and fall back to returning all UTXOs.
 */
const tryDecode = (amountHex: string): CardanoValueRequirement | null => {
  const stripped = stripHexPrefix(amountHex)
  // Buffer.from('...', 'hex') silently truncates at the first non-hex byte,
  // which would let `0xgg` or odd-length inputs squeak past as valid-looking
  // (but wrong) CBOR. Validate up front.
  if (stripped.length === 0 || stripped.length % 2 !== 0 || !hexPattern.test(stripped)) {
    return null
  }

  const bytes = Uint8Array.from(Buffer.from(stripped, 'hex'))
  if (bytes.length === 0) return null

  const decoded = cardanoCborEncoder.decode(bytes)

  if (Array.isArray(decoded) && decoded.length === 2) {
    const lovelace = toBigInt(decoded[0])
    if (lovelace === null) return null
    const ma = decoded[1]
    if (!isMultiassetShape(ma)) return null
    return { lovelace, hasAssets: multiassetHasEntries(ma) }
  }

  const lovelace = toBigInt(decoded)
  if (lovelace === null) return null
  return { lovelace, hasAssets: false }
}

export const decodeCardanoAmountValue = (
  amountHex: string
): CardanoValueRequirement | null => {
  const result = attempt(() => tryDecode(amountHex))
  if ('error' in result) return null
  return result.data ?? null
}
