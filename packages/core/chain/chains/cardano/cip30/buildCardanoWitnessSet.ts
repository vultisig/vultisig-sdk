/**
 * Build a CIP-30 witness set CBOR from a public key and signature.
 *
 * CIP-30 signTx returns just the witness set (not the full signed tx):
 *     { 0: [ [vkey_bytes(32), signature_bytes(64)] ] }
 */
import {
  cborArray,
  cborBytes,
  cborMap,
  cborUint,
} from './cardanoCborPrimitives'

type BuildCardanoWitnessSetInput = {
  /** 32-byte Ed25519 public key (raw bytes, not hex). */
  publicKey: Uint8Array
  /** 64-byte Ed25519 signature (raw bytes, not hex). */
  signature: Uint8Array
}

/** Return the witness set as CBOR bytes. */
export const buildCardanoWitnessSet = ({
  publicKey,
  signature,
}: BuildCardanoWitnessSetInput): Uint8Array =>
  cborMap([
    [
      cborUint(0),
      cborArray([cborArray([cborBytes(publicKey), cborBytes(signature)])]),
    ],
  ])
