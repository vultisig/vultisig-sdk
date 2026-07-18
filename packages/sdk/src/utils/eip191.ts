import { keccak_256 } from '@noble/hashes/sha3.js'

const hexPattern = /^[0-9a-f]+$/i
const eip191Prefix = '\x19Ethereum Signed Message:\n'
const secp256k1Order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

const stripHexPrefix = (value: string): string =>
  value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value

const parseHex = (value: string): Uint8Array => {
  const hex = stripHexPrefix(value)
  if (!hex || hex.length % 2 !== 0 || !hexPattern.test(hex)) {
    throw new Error('Invalid ECDSA signature: expected an even-length hexadecimal string')
  }

  const result = new Uint8Array(hex.length / 2)
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return result
}

const toHex = (value: Uint8Array): string => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('')

const readDerInteger = (der: Uint8Array, offset: number, label: 'r' | 's') => {
  if (der[offset] !== 0x02) {
    throw new Error(`Invalid DER signature: expected INTEGER for ${label}`)
  }

  const length = der[offset + 1]
  const start = offset + 2
  const end = start + length
  if (!length || end > der.length) {
    throw new Error(`Invalid DER signature: truncated ${label}`)
  }

  let value = der.subarray(start, end)
  if ((value[0] & 0x80) !== 0) {
    throw new Error(`Invalid DER signature: ${label} must be positive`)
  }
  if (value.length > 1 && value[0] === 0) {
    if ((value[1] & 0x80) === 0) {
      throw new Error(`Invalid DER signature: ${label} has non-canonical padding`)
    }
    value = value.subarray(1)
  }
  if (value.length > 32) {
    throw new Error(`Invalid DER signature: ${label} exceeds 32 bytes`)
  }
  if (value.every(byte => byte === 0)) {
    throw new Error(`Invalid DER signature: ${label} cannot be zero`)
  }

  const padded = new Uint8Array(32)
  padded.set(value, 32 - value.length)
  return { value: padded, nextOffset: end }
}

const derToRawSignature = (der: Uint8Array): Uint8Array => {
  if (der.length < 8 || der[0] !== 0x30) {
    throw new Error('Invalid DER signature: expected SEQUENCE')
  }
  if (der[1] !== der.length - 2) {
    throw new Error('Invalid DER signature: sequence length mismatch')
  }

  const r = readDerInteger(der, 2, 'r')
  const s = readDerInteger(der, r.nextOffset, 's')
  if (s.nextOffset !== der.length) {
    throw new Error('Invalid DER signature: trailing data')
  }

  const result = new Uint8Array(64)
  result.set(r.value)
  result.set(s.value, 32)
  return result
}

const assertValidScalar = (value: Uint8Array, label: 'r' | 's') => {
  const scalar = BigInt(`0x${toHex(value)}`)
  if (scalar === 0n || scalar >= secp256k1Order) {
    throw new Error(`Invalid ECDSA signature: ${label} is outside the secp256k1 scalar range`)
  }
}

/** Compute the EIP-191 `personal_sign` digest for a UTF-8 message. */
export const computePersonalSignHash = (message: string): Uint8Array => {
  const messageBytes = new TextEncoder().encode(message)
  const prefixBytes = new TextEncoder().encode(`${eip191Prefix}${messageBytes.length}`)
  const payload = new Uint8Array(prefixBytes.length + messageBytes.length)
  payload.set(prefixBytes)
  payload.set(messageBytes, prefixBytes.length)
  return keccak_256(payload)
}

/**
 * Convert an ECDSA DER signature or exact 64-byte raw `r || s` signature into
 * the unprefixed Ethereum `r || s || v` form used by `personal_sign`.
 */
export const formatEcdsaSignature65 = (signature: string, recovery: number): string => {
  if (recovery !== 0 && recovery !== 1) {
    throw new Error('Invalid ECDSA recovery id: expected 0 or 1')
  }

  const bytes = parseHex(signature)
  let raw: Uint8Array
  if (bytes[0] === 0x30) {
    try {
      raw = derToRawSignature(bytes)
    } catch (error) {
      if (bytes.length !== 64) {
        throw error
      }
      raw = bytes
    }
  } else {
    if (bytes.length !== 64) {
      throw new Error(`Invalid ECDSA signature: unrecognized format (${bytes.length} bytes)`)
    }
    raw = bytes
  }
  assertValidScalar(raw.subarray(0, 32), 'r')
  assertValidScalar(raw.subarray(32), 's')
  return `${toHex(raw)}${(recovery + 27).toString(16)}`
}
