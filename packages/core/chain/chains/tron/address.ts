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

// Preserve the address prefixes historically accepted by core balance lookup.
const TRON_NETWORK_PREFIXES: readonly number[] = [0x41, 0xa0]

/** Decode a checksum-valid 21-byte Tron address, retaining its network prefix. */
export function decodeTronAddress(address: string): Uint8Array {
  // Throws if the checksum is invalid - intentional.
  const decoded = _decode(address)

  // 21 bytes: 1-byte network prefix + 20-byte EVM address.
  if (decoded.length !== 21 || !TRON_NETWORK_PREFIXES.includes(decoded[0])) {
    throw new Error(
      `invalid tron address prefix: expected ${TRON_NETWORK_PREFIXES.map(p => `0x${p.toString(16)}`).join(' or ')}, got 0x${decoded[0]?.toString(16) ?? '??'} (length ${decoded.length})`
    )
  }

  return decoded
}
