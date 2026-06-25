import { sha256 } from '@noble/hashes/sha2'

/**
 * TRON address + TRC-20 ABI helpers (pure crypto — no RPC, no signing).
 *
 * Ported from the mcp-ts `lib/tron-abi.ts` builder so the SDK is the single
 * source of truth for TRON TRC-20 calldata encoding. This module ONLY encodes
 * an unsigned `transfer(address,uint256)` parameter blob and converts between
 * TRON base58check and hex address forms. It never signs and never broadcasts.
 *
 * The emitted `parameter` is the 128-char hex the on-device signer expects:
 * the 32-byte left-padded recipient address word followed by the 32-byte
 * left-padded uint256 amount word (no 0x prefix, no 4-byte selector — the
 * client hashes `transfer(address,uint256)` itself and concatenates).
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

// Module-scope decode map so the alphabet table isn't rebuilt per call.
const BASE58_MAP: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>()
  for (let i = 0; i < BASE58_ALPHABET.length; i++) m.set(BASE58_ALPHABET[i], i)
  return m
})()

const base58Decode = (input: string): Uint8Array => {
  if (input.length === 0) return new Uint8Array()

  const bytes: number[] = []
  for (const ch of input) {
    const value = BASE58_MAP.get(ch)
    if (value === undefined) throw new Error(`base58: invalid character ${ch}`)
    let carry = value
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58
      bytes[j] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  // Leading 1s in input become leading zero bytes.
  for (const ch of input) {
    if (ch === '1') bytes.push(0)
    else break
  }
  return new Uint8Array(bytes.reverse())
}

const base58Encode = (input: Uint8Array): string => {
  if (input.length === 0) return ''

  const digits: number[] = []
  for (const byte of input) {
    let carry = byte
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = Math.floor(carry / 58)
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = Math.floor(carry / 58)
    }
  }

  let out = ''
  for (const byte of input) {
    if (byte === 0) out += '1'
    else break
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    out += BASE58_ALPHABET[digits[i]!]
  }
  return out
}

const sha256d = (data: Uint8Array): Uint8Array => sha256(sha256(data))

const base58CheckEncode = (payload: Uint8Array): string => {
  const checksum = sha256d(payload).slice(0, 4)
  const combined = new Uint8Array(payload.length + checksum.length)
  combined.set(payload)
  combined.set(checksum, payload.length)
  return base58Encode(combined)
}

/**
 * Convert a TRON base58 address (T...) to its 40-char EVM-style hex (no 0x41
 * prefix, no 0x prefix, no checksum) — the raw 20 address bytes as hex.
 *
 * Verifies the base58check checksum so a typoed-but-still-base58-decodable
 * string can't silently re-checksum into a DIFFERENT valid address (fund
 * safety: a wrong recipient must surface as an error, not a silent misroute).
 */
export const tronBase58ToEvmHex = (base58Addr: string): string => {
  const decoded = base58Decode(base58Addr)
  if (decoded.length !== 25) {
    throw new Error(`tronBase58ToEvmHex: expected 25-byte decode, got ${decoded.length} for ${base58Addr}`)
  }
  if (decoded[0] !== 0x41) {
    throw new Error(`tronBase58ToEvmHex: expected 0x41 prefix, got 0x${decoded[0].toString(16)}`)
  }
  const payload = decoded.slice(0, 21)
  const expectedChecksum = sha256d(payload).slice(0, 4)
  const actualChecksum = decoded.slice(21, 25)
  for (let i = 0; i < 4; i++) {
    if (actualChecksum[i] !== expectedChecksum[i]) {
      throw new Error(`tronBase58ToEvmHex: base58check checksum mismatch for ${base58Addr}`)
    }
  }
  // drop first byte (prefix) + last 4 bytes (checksum) → 20 raw bytes
  const addrBytes = decoded.slice(1, 21)
  return Array.from(addrBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Convert a TRON base58 address (T...) to its 42-char TRON hex form
 * (0x41 network prefix + 20 address bytes, no checksum).
 */
export const tronBase58ToHex = (base58Addr: string): string => `41${tronBase58ToEvmHex(base58Addr)}`

/**
 * Convert a 40-char EVM-style address hex (or 42-char TRON hex with 0x41
 * prefix) to a TRON base58check address.
 */
export const tronHexToBase58 = (hexAddr: string): string => {
  const clean = hexAddr.replace(/^0x/i, '').toLowerCase()
  const tronHex = clean.length === 40 ? `41${clean}` : clean
  if (!/^41[0-9a-f]{40}$/.test(tronHex)) {
    throw new Error(`tronHexToBase58: expected 20-byte hex address or 0x41-prefixed TRON hex, got ${hexAddr}`)
  }
  const payload = Uint8Array.from(tronHex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)))
  return base58CheckEncode(payload)
}

/**
 * ABI-encode the parameters of `transfer(address,uint256)`:
 *   - 32-byte left-padded recipient address (20-byte hex, left-padded to 64 chars)
 *   - 32-byte left-padded uint256 amount (hex, 64 chars)
 *
 * Returns the concatenated 128-char hex string (no 0x prefix, no selector).
 */
export const encodeTrc20TransferParam = (toBase58: string, amountBase: string): string => {
  const addrHex = tronBase58ToEvmHex(toBase58)
  const paddedAddr = addrHex.padStart(64, '0')
  // Amount MUST fit in uint256. Reject out-of-range rather than silently
  // emitting a malformed word that would under/overflow on the signer side.
  const amount = BigInt(amountBase)
  if (amount < 0n) {
    throw new Error(`encodeTrc20TransferParam: negative amount ${amountBase}`)
  }
  if (amount >= 1n << 256n) {
    throw new Error(`encodeTrc20TransferParam: amount ${amountBase} exceeds uint256 max`)
  }
  const amountHex = amount.toString(16)
  const paddedAmount = amountHex.padStart(64, '0')
  return paddedAddr + paddedAmount
}
