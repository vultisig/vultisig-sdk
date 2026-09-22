import { fromBech32 } from '@cosmjs/encoding'

/**
 * BIP-173 caps a bech32 string at 90 characters, which every address decoded
 * through this helper fits within (Cardano addresses exceed it and have their
 * own decoder). The cap must be passed explicitly: `fromBech32` defaults it to
 * `Infinity`, which `@scure/base` >= 2.3 rejects as a non-integer limit, so a
 * bare `fromBech32(address)` throws on every input once a consumer's lockfile
 * resolves that version.
 */
const bech32MaxLength = 90

/**
 * Decodes a bech32 address into its human-readable prefix and raw data bytes.
 * Throws on malformed input, exactly like `fromBech32`.
 */
export const decodeBech32 = (address: string) => fromBech32(address, bech32MaxLength)
