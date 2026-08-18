import bs58check from 'bs58check'

// bs58check v4 ships as ESM with a CJS-compat default export depending on
// the bundler. Resolve the decode function once at module load time and
// throw immediately if unavailable — fail on startup, not mid-request.
type Bs58CheckMod = { decode?: (s: string) => Uint8Array; default?: { decode: (s: string) => Uint8Array } }
const _mod = bs58check as unknown as Bs58CheckMod
const _decode: (s: string) => Uint8Array = (() => {
  const fn = _mod.decode ?? _mod.default?.decode
  if (!fn) throw new Error('bs58check.decode unavailable — bundler did not resolve bs58check correctly')
  return fn
})()

/** Tron network prefixes. 0x41 = mainnet, 0xa0 = Nile testnet. */
export const TRON_NETWORK_PREFIXES: readonly number[] = [0x41, 0xa0]

/**
 * Decodes and checksum/prefix-validates a Tron Base58Check address, returning
 * the raw 21-byte payload (1-byte network prefix + 20-byte EVM-compatible
 * address).
 *
 * The single canonical decoder shared by core-chain's balance/discovery
 * resolvers and the SDK's Tron tx builder, so mainnet (0x41) and Nile
 * testnet (0xa0) addresses are accepted identically on every first-party
 * surface — previously the SDK tx builder carried its own copy that only
 * accepted 0x41.
 *
 * Tron addresses are Base58Check-encoded 21-byte payloads. Using plain bs58
 * (no checksum) silently produces a wrong 20-byte value when the input
 * address is corrupted or mistyped, causing balance queries to hit a
 * completely different account and return 0 without any error, or a tx
 * builder to sign a payload for the wrong recipient. `bs58check.decode`
 * verifies the 4-byte SHA-256d checksum and throws on mismatch, so callers
 * get an explicit error rather than silent misdirection.
 */
export function decodeTronBase58Address(address: string): Uint8Array {
  // Throws if the checksum is invalid - intentional.
  const decoded = _decode(address)

  if (decoded.length !== 21 || !TRON_NETWORK_PREFIXES.includes(decoded[0])) {
    throw new Error(
      `invalid tron address prefix: expected ${TRON_NETWORK_PREFIXES.map(p => `0x${p.toString(16)}`).join(' or ')}, got 0x${decoded[0]?.toString(16) ?? '??'} (length ${decoded.length})`
    )
  }

  return decoded
}
