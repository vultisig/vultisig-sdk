import { decode } from 'cbor-x'

const ttlBodyKey = 3

const getBodyValue = (body: unknown, key: number): unknown => {
  if (body instanceof Map) {
    return body.get(key)
  }

  if (body && typeof body === 'object') {
    return (body as Record<string, unknown>)[String(key)]
  }

  return undefined
}

const toTtl = (value: unknown): bigint => {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value)
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value)
  }

  throw new Error('Invalid Cardano transaction TTL')
}

/**
 * Extract the absolute slot TTL from a signed Cardano transaction CBOR.
 *
 * Cardano transaction bodies are CBOR maps; key 3 is `ttl`. We only decode for
 * inspection and never re-encode, so this cannot perturb the tx hash.
 */
export const getCardanoTxTtl = (txCbor: Uint8Array): bigint => {
  const decoded = decode(txCbor)

  if (!Array.isArray(decoded) || decoded.length < 1) {
    throw new Error('Invalid Cardano transaction CBOR: expected array')
  }

  return toTtl(getBodyValue(decoded[0], ttlBodyKey))
}
