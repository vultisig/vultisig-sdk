/**
 * Wrap a WalletCore-produced Cardano tx body with witness CBOR.
 *
 * compileWithSignatures() calls encodeTransactionWithSig() which hits
 * AddressV2::isValid() — crashing under WASM DISABLE_EXCEPTION_CATCHING.
 * This module manually wraps the pre-signed tx body (from preImageHashes)
 * with a CBOR witness set, producing a valid signed Cardano transaction.
 *
 * The tx body bytes are embedded verbatim (not re-encoded) because the
 * MPC signature covers Blake2b of the exact bytes. Re-encoding could
 * change key ordering or integer widths, invalidating the signature.
 *
 * The witness set is hand-encoded because common JS CBOR libraries tag
 * Maps or encode object keys as text strings — Cardano requires plain
 * CBOR maps with unsigned-integer keys.
 */

type BuildSignedCardanoTxInput = {
  /** CBOR-encoded transaction body from PreSigningOutput.data */
  txBodyCbor: Uint8Array
  /** 32-byte Ed25519 spending public key */
  publicKey: Uint8Array
  /** 64-byte Ed25519 signature (r || s, each little-endian) */
  signature: Uint8Array
}

/**
 * Encode a CBOR byte string: major type 2, then length, then data.
 * Supports lengths up to 65535 (two-byte length).
 */
const cborBytes = (data: Uint8Array): Uint8Array => {
  if (data.length < 24) {
    const out = new Uint8Array(1 + data.length)
    out[0] = 0x40 | data.length
    out.set(data, 1)
    return out
  }
  if (data.length < 256) {
    const out = new Uint8Array(2 + data.length)
    out[0] = 0x58
    out[1] = data.length
    out.set(data, 2)
    return out
  }
  const out = new Uint8Array(3 + data.length)
  out[0] = 0x59
  out[1] = (data.length >> 8) & 0xff
  out[2] = data.length & 0xff
  out.set(data, 3)
  return out
}

/**
 * Build the witness set CBOR: a1 00 81 82 5820<vkey> 5840<sig>
 * = map(1) { 0 => [ [bytes(32), bytes(64)] ] }
 */
const buildWitnessCbor = (
  publicKey: Uint8Array,
  signature: Uint8Array
): Uint8Array => {
  const vkeyCbor = cborBytes(publicKey)
  const sigCbor = cborBytes(signature)

  // inner array [vkey, sig]: 0x82 = array(2)
  const pair = concat([new Uint8Array([0x82]), vkeyCbor, sigCbor])

  // outer array [[vkey, sig]]: 0x81 = array(1)
  const arr = concat([new Uint8Array([0x81]), pair])

  // map {0 => arr}: 0xa1 = map(1), 0x00 = uint(0)
  return concat([new Uint8Array([0xa1, 0x00]), arr])
}

const concat = (parts: Uint8Array[]): Uint8Array => {
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0)
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const p of parts) {
    result.set(p, offset)
    offset += p.length
  }
  return result
}

/** Returns the full signed Cardano transaction as CBOR bytes. */
export const buildSignedCardanoTx = ({
  txBodyCbor,
  publicKey,
  signature,
}: BuildSignedCardanoTxInput): Uint8Array => {
  const witnessCbor = buildWitnessCbor(publicKey, signature)

  // Signed tx: 0x84 [tx_body, witnesses, isValid, auxiliary_data]
  return concat([
    new Uint8Array([0x84]),
    txBodyCbor,
    witnessCbor,
    new Uint8Array([0xf5]), // CBOR true (is_valid)
    new Uint8Array([0xf6]), // CBOR null (no auxiliary data)
  ])
}
