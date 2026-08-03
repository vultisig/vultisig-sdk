/**
 * Bitcoin Cash CashAddr validation — shared between the address-format
 * fund-safety gate (isAddressValidForChain) and the UTXO tx builder.
 *
 * Spec: https://reference.cash/protocol/blockchain/encoding/cashaddr
 *
 * Both consumers MUST agree on what a "valid BCH address" is — a regex that
 * only checks the charset/length (as the format gate previously did) accepts a
 * single-character typo whose polymod checksum is wrong, so the fund-safety
 * gate would green-light an address the tx builder later rejects (or, on a code
 * path that skips the builder's check, an address the user never intended).
 */

/** CashAddr base32 alphabet. Note it excludes b, i, o and 1. */
export const CASHADDR_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

/**
 * CashAddr polymod checksum.
 *
 * The checksum is computed over `lower5(prefix) || 0 || payload5` (payload5
 * already contains the 8 trailing checksum symbols). A valid address produces
 * polymod === 0. BigInt is required: the generator coefficients exceed 32 bits
 * and JS `number` bit-ops truncate to i32, which silently drops the checksum's
 * top bits and would accept invalid addresses.
 */
export function cashAddrPolymod(values: number[]): bigint {
  const GEN: bigint[] = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n]
  let c: bigint = 1n
  for (const v of values) {
    const c0 = c >> 35n
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(v)
    for (let i = 0; i < 5; i++) {
      if (((c0 >> BigInt(i)) & 1n) === 1n) c ^= GEN[i]!
    }
  }
  return c ^ 1n
}

/** Verify the polymod checksum for a decoded (prefix, data5) CashAddr. */
export function verifyCashAddrChecksum(prefix: string, data5: number[]): boolean {
  const prefixLower5 = Array.from(prefix, ch => ch.charCodeAt(0) & 0x1f)
  const values = [...prefixLower5, 0, ...data5]
  return cashAddrPolymod(values) === 0n
}

/**
 * Full validity check for a mainnet BCH CashAddr (P2PKH `q...` / P2SH `p...`),
 * with or without the `bitcoincash:` prefix. Enforces the canonical 42-symbol
 * payload length, the base32 charset (so b/i/o/1 and any uppercase are
 * rejected — mixed-case CashAddr is invalid), and the polymod checksum.
 */
export function isValidCashAddr(address: string): boolean {
  const trimmed = address.trim()
  const payload = trimmed.startsWith('bitcoincash:') ? trimmed.slice('bitcoincash:'.length) : trimmed
  // Mainnet P2PKH/P2SH CashAddr payloads are exactly 42 base32 symbols
  // (1 version symbol + 33 hash symbols + 8 checksum symbols).
  if (payload.length !== 42) return false
  const data5: number[] = []
  for (const c of payload) {
    const idx = CASHADDR_CHARSET.indexOf(c)
    if (idx === -1) return false
    data5.push(idx)
  }
  return verifyCashAddrChecksum('bitcoincash', data5)
}
