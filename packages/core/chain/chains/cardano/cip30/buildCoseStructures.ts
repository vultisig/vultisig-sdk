/**
 * CIP-8 / CIP-30 signData helpers.
 *
 * Builds the COSE_Sign1 and COSE_Key structures for Cardano message signing.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8152
 * @see https://cips.cardano.org/cip/CIP-0008
 */
import {
  cborArray,
  cborBytes,
  cborMap,
  cborNegint,
  cborText,
  cborUint,
  concat,
} from './cardanoCborPrimitives'

/**
 * Build the protected headers for a CIP-8 COSE_Sign1:
 *
 *     { 1: -8,  "address": <address_bytes> }
 *
 * Key `1` = alg, value `-8` = EdDSA (IANA COSE algorithm).
 */
const buildProtectedHeaders = (addressBytes: Uint8Array): Uint8Array =>
  cborMap([
    [cborUint(1), cborNegint(7)],
    [cborText('address'), cborBytes(addressBytes)],
  ])

/**
 * Build the Sig_structure that is the input to Ed25519 signing:
 *
 *     ["Signature1", protected_bytes, external_aad, payload]
 */
export const buildSigStructure = (
  protectedBytes: Uint8Array,
  payload: Uint8Array
): Uint8Array =>
  cborArray([
    cborText('Signature1'),
    cborBytes(protectedBytes),
    cborBytes(new Uint8Array(0)), // empty external_aad
    cborBytes(payload),
  ])

type BuildCoseSign1Input = {
  /** Raw address bytes (not hex). */
  addressBytes: Uint8Array
  /** Payload bytes (the hex-decoded payload from the dApp). */
  payload: Uint8Array
  /** 64-byte Ed25519 signature. */
  signature: Uint8Array
}

/**
 * Build and return the full COSE_Sign1 CBOR:
 *
 *     [protected: bstr, unprotected: {}, payload: bstr, signature: bstr]
 *
 * Also returns the `protectedSerialized` bytes needed to compute the
 * Sig_structure before signing.
 */
export const buildCoseSign1 = ({
  addressBytes,
  payload,
  signature,
}: BuildCoseSign1Input): Uint8Array => {
  const protectedSerialized = buildProtectedHeaders(addressBytes)
  return cborArray([
    cborBytes(protectedSerialized),
    cborMap([]), // empty unprotected headers
    cborBytes(payload),
    cborBytes(signature),
  ])
}

/**
 * Return the serialized protected headers for a given address.
 * Used by the caller to build the Sig_structure before MPC signing.
 */
export const buildProtectedHeaderBytes = (
  addressBytes: Uint8Array
): Uint8Array => buildProtectedHeaders(addressBytes)

type BuildCoseKeyInput = {
  /** 32-byte Ed25519 public key (raw bytes). */
  publicKey: Uint8Array
}

/**
 * Build a COSE_Key for an Ed25519 public key:
 *
 *     { 1: 1, 3: -8, -1: 6, -2: <pubkey> }
 *
 * - Key 1 (kty) = 1 (OKP)
 * - Key 3 (alg) = -8 (EdDSA)
 * - Key -1 (crv) = 6 (Ed25519)
 * - Key -2 (x)   = public key bytes
 */
export const buildCoseKey = ({ publicKey }: BuildCoseKeyInput): Uint8Array =>
  cborMap([
    [cborUint(1), cborUint(1)],
    [cborUint(3), cborNegint(7)],
    [cborNegint(0), cborUint(6)],
    [cborNegint(1), cborBytes(publicKey)],
  ])
