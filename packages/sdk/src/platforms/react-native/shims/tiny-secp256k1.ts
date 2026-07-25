/**
 * tiny-secp256k1 shim using @noble/curves for React Native (Hermes).
 * The real tiny-secp256k1 uses WASM bindings that don't work in Hermes.
 * This provides the subset of the API used by bip32 (BIP32Factory).
 */
import { secp256k1 } from '@noble/curves/secp256k1.js'

const GE = secp256k1.Point
const CURVE_N = GE.CURVE().n

function isPoint(p: Uint8Array): boolean {
  try {
    GE.fromBytes(p)
    return true
  } catch {
    return false
  }
}

function isPrivate(d: Uint8Array): boolean {
  if (d.length !== 32) return false
  const n = BigInt('0x' + Buffer.from(d).toString('hex'))
  return n > 0n && n < CURVE_N
}

function pointFromScalar(d: Uint8Array, compressed = true): Uint8Array | null {
  try {
    if (!isPrivate(d)) return null
    const n = BigInt('0x' + Buffer.from(d).toString('hex'))
    const pt = GE.BASE.multiply(n)
    return pt.toBytes(compressed)
  } catch {
    return null
  }
}

function pointAddScalar(p: Uint8Array, tweak: Uint8Array, compressed = true): Uint8Array | null {
  try {
    const pt = GE.fromBytes(p)
    if (tweak.length !== 32) return null
    const t = BigInt('0x' + Buffer.from(tweak).toString('hex'))
    if (t >= CURVE_N) return null
    if (t === 0n) return pt.toBytes(compressed)
    const tweakPt = GE.BASE.multiply(t)
    const result = pt.add(tweakPt)
    return result.toBytes(compressed)
  } catch {
    return null
  }
}

function privateAdd(d: Uint8Array, tweak: Uint8Array): Uint8Array | null {
  try {
    if (!isPrivate(d) || tweak.length !== 32) return null
    const dN = BigInt('0x' + Buffer.from(d).toString('hex'))
    const tN = BigInt('0x' + Buffer.from(tweak).toString('hex'))
    if (tN >= CURVE_N) return null
    // Both dN and tN are read as unsigned 256-bit integers. For secp256k1 scalar
    // addition, tweak values representing negative scalars (> n/2) work correctly
    // because (dN + tN) % n produces the same result as modular addition with
    // signed interpretation — BigInt handles arbitrary precision without overflow.
    const sum = (dN + tN) % CURVE_N
    if (sum === 0n) return null
    const hex = sum.toString(16).padStart(64, '0')
    return Buffer.from(hex, 'hex')
  } catch {
    return null
  }
}

function sign(h: Uint8Array, d: Uint8Array, extraData?: Uint8Array): Uint8Array {
  const signature = secp256k1.sign(h, d, {
    prehash: false,
    format: 'compact',
    ...(extraData ? { extraEntropy: extraData } : {}),
  }) as unknown
  if (signature instanceof Uint8Array) return signature
  const legacySignature = signature as { toCompactRawBytes?: () => Uint8Array }
  if (typeof legacySignature.toCompactRawBytes === 'function') {
    return legacySignature.toCompactRawBytes()
  }
  throw new Error('unsupported @noble/curves signature result')
}

function verify(h: Uint8Array, Q: Uint8Array, signature: Uint8Array): boolean {
  try {
    return secp256k1.verify(signature, h, Q, { prehash: false, format: 'compact' })
  } catch {
    return false
  }
}

const ecc = {
  isPoint,
  isPrivate,
  pointFromScalar,
  pointAddScalar,
  privateAdd,
  sign,
  verify,
}

export default ecc
export { isPoint, isPrivate, pointAddScalar, pointFromScalar, privateAdd, sign, verify }
