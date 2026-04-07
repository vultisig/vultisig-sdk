/**
 * tiny-secp256k1 shim using @noble/curves for React Native (Hermes).
 * The real tiny-secp256k1 uses WASM bindings that don't work in Hermes.
 * This provides the subset of the API used by bip32 (BIP32Factory).
 */
import { secp256k1 } from '@noble/curves/secp256k1'

const GE = secp256k1.ProjectivePoint

function isPoint(p: Uint8Array): boolean {
  try {
    GE.fromHex(p)
    return true
  } catch {
    return false
  }
}

function isPrivate(d: Uint8Array): boolean {
  if (d.length !== 32) return false
  const n = BigInt('0x' + Buffer.from(d).toString('hex'))
  return n > 0n && n < secp256k1.CURVE.n
}

function pointFromScalar(d: Uint8Array, compressed = true): Uint8Array | null {
  try {
    const n = BigInt('0x' + Buffer.from(d).toString('hex'))
    const pt = GE.BASE.multiply(n)
    return pt.toRawBytes(compressed)
  } catch {
    return null
  }
}

function pointAddScalar(p: Uint8Array, tweak: Uint8Array, compressed = true): Uint8Array | null {
  try {
    const pt = GE.fromHex(p)
    const t = BigInt('0x' + Buffer.from(tweak).toString('hex'))
    const tweakPt = GE.BASE.multiply(t)
    const result = pt.add(tweakPt)
    return result.toRawBytes(compressed)
  } catch {
    return null
  }
}

function privateAdd(d: Uint8Array, tweak: Uint8Array): Uint8Array | null {
  try {
    const dN = BigInt('0x' + Buffer.from(d).toString('hex'))
    const tN = BigInt('0x' + Buffer.from(tweak).toString('hex'))
    const sum = (dN + tN) % secp256k1.CURVE.n
    if (sum === 0n) return null
    const hex = sum.toString(16).padStart(64, '0')
    return Buffer.from(hex, 'hex')
  } catch {
    return null
  }
}

function sign(h: Uint8Array, d: Uint8Array): Uint8Array {
  const sig = secp256k1.sign(h, d)
  return sig.toCompactRawBytes()
}

function verify(h: Uint8Array, Q: Uint8Array, signature: Uint8Array): boolean {
  try {
    return secp256k1.verify(signature, h, Q)
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
