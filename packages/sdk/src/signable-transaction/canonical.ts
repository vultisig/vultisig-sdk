import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import type { SignableUnsignedPayloadV1 } from './schema'
import { signableUnsignedPayloadV1Schema } from './schema'

export type SignableCanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly SignableCanonicalValue[]
  | { readonly [key: string]: SignableCanonicalValue }

const canonicalize = (value: unknown, seen: Set<object>): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError('Canonical signable-transaction numbers must be safe integers; encode amounts as strings')
    }
    return Object.is(value, -0) ? '0' : String(value)
  }

  if (typeof value !== 'object') {
    throw new TypeError(`Unsupported canonical signable-transaction value: ${typeof value}`)
  }

  if (seen.has(value)) throw new TypeError('Canonical signable-transaction values cannot contain cycles')
  seen.add(value)

  try {
    if (Array.isArray(value)) return `[${value.map(item => canonicalize(item, seen)).join(',')}]`

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Canonical signable-transaction values must contain only plain objects')
    }

    const object = value as Record<string, unknown>
    const entries = Object.keys(object)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalize(object[key], seen)}`)
    return `{${entries.join(',')}}`
  } finally {
    seen.delete(value)
  }
}

/**
 * Deterministic JSON canonicalization used by every v1 payload, display and
 * approval digest. Object keys are sorted, array order is preserved and
 * ambiguous values (floats, bigint, undefined, custom prototypes) fail closed.
 */
export const canonicalizeSignableTransactionValue = (value: SignableCanonicalValue): string =>
  canonicalize(value, new Set())

export const hashSignableTransactionValue = (value: SignableCanonicalValue): `sha256:${string}` => {
  const bytes = new TextEncoder().encode(canonicalizeSignableTransactionValue(value))
  return `sha256:${bytesToHex(sha256(bytes))}`
}

const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const decodeCanonicalBase64 = (value: string): Uint8Array => {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const output = new Uint8Array((value.length / 4) * 3 - padding)
  let outputIndex = 0

  for (let index = 0; index < value.length; index += 4) {
    const a = base64Alphabet.indexOf(value[index]!)
    const b = base64Alphabet.indexOf(value[index + 1]!)
    const c = value[index + 2] === '=' ? 0 : base64Alphabet.indexOf(value[index + 2]!)
    const d = value[index + 3] === '=' ? 0 : base64Alphabet.indexOf(value[index + 3]!)
    const bits = (a << 18) | (b << 12) | (c << 6) | d
    if (outputIndex < output.length) output[outputIndex++] = (bits >>> 16) & 0xff
    if (outputIndex < output.length) output[outputIndex++] = (bits >>> 8) & 0xff
    if (outputIndex < output.length) output[outputIndex++] = bits & 0xff
  }

  return output
}

/** SHA-256 of the exact unsigned transaction bytes, independent of transport encoding. */
export const hashSignableUnsignedPayloadV1 = (payloadInput: SignableUnsignedPayloadV1): `sha256:${string}` => {
  const payload = signableUnsignedPayloadV1Schema.parse(payloadInput)
  const bytes =
    payload.encoding === 'hex'
      ? hexToBytes(payload.value)
      : payload.encoding === 'base64'
        ? decodeCanonicalBase64(payload.value)
        : utf8ToBytes(payload.value)
  return `sha256:${bytesToHex(sha256(bytes))}`
}
