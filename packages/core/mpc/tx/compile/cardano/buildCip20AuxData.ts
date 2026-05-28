import { blake2b } from '@noble/hashes/blake2b'
import {
  cborArray,
  cborBytes,
  cborMap,
  cborText,
  cborUint,
} from '@vultisig/core-chain/chains/cardano/cip30/cardanoCborPrimitives'

/** CIP-20 limits each metadata text chunk to 64 UTF-8 bytes. */
const MAX_CHUNK_BYTES = 64

/**
 * Split a memo string into chunks of at most 64 UTF-8 bytes each.
 *
 * Each chunk respects UTF-8 character boundaries: a multi-byte codepoint
 * straddling the 64-byte boundary is moved entirely to the next chunk
 * instead of being torn (which would produce U+FFFD replacement chars on
 * decode and corrupt the memo as it lands on-chain).
 *
 * UTF-8 leading bytes have the bit pattern 0xxxxxxx, 110xxxxx, 1110xxxx,
 * or 11110xxx. Continuation bytes have the pattern 10xxxxxx. To find a
 * safe cut point we walk back from the proposed end until the byte at
 * `end` is a leading byte (or we hit the chunk start, in which case the
 * input is malformed and we keep the original cut).
 */
export function memoToChunks(memo: string): string[] {
  const bytes = new TextEncoder().encode(memo)
  if (bytes.length === 0) return ['']
  const chunks: string[] = []
  const decoder = new TextDecoder()

  let start = 0
  while (start < bytes.length) {
    let end = Math.min(start + MAX_CHUNK_BYTES, bytes.length)

    // If we are not at the end of the buffer and `end` lands on a UTF-8
    // continuation byte (top bits 10xxxxxx), back up until we hit the
    // start of that codepoint. The next chunk will pick up the codepoint
    // intact.
    if (end < bytes.length) {
      while (end > start && (bytes[end]! & 0xc0) === 0x80) {
        end--
      }
      // Defensive: if walking back consumed the whole chunk (malformed
      // input — > 64 bytes of continuation bytes in a row, impossible
      // for any valid UTF-8 codepoint which maxes at 4 bytes), fall back
      // to the original cut so we make forward progress.
      if (end === start) {
        end = Math.min(start + MAX_CHUNK_BYTES, bytes.length)
      }
    }

    chunks.push(decoder.decode(bytes.slice(start, end)))
    start = end
  }
  return chunks
}

/**
 * Encode the CIP-20 transaction metadata for a given memo string.
 *
 * Produces:
 *   { 674: { "msg": ["<chunk1>", "<chunk2>", ...] } }
 *
 * The label 674 is the CIP-20 metadata label registered on cardano.org.
 *
 * @returns
 *   - `auxDataCbor` — the canonical CBOR bytes to embed as element [3] of
 *     the signed transaction array (replaces the `0xf6` null sentinel).
 *   - `auxDataHash` — blake2b-256 of `auxDataCbor`, to be committed in the
 *     tx body at CBOR map key 7 (auxiliary_data_hash).
 */
export function buildCip20AuxData(memo: string): {
  auxDataCbor: Uint8Array
  auxDataHash: Uint8Array
} {
  const chunks = memoToChunks(memo)
  const msgArray = cborArray(chunks.map(c => cborText(c)))
  const innerMap = cborMap([[cborText('msg'), msgArray]])
  const auxDataCbor = cborMap([[cborUint(674), innerMap]])
  const auxDataHash = blake2b(auxDataCbor, { dkLen: 32 })
  return { auxDataCbor, auxDataHash }
}

/**
 * Re-emit a WalletCore-produced CBOR tx body with an `auxiliary_data_hash`
 * entry (CBOR map key 7) appended.
 *
 * WalletCore emits the tx body as a CBOR map. We avoid a full decode/encode
 * round-trip (which could alter key ordering or integer widths and invalidate
 * the MPC signature) by:
 *   1. Reading the initial CBOR map header byte to extract the current count.
 *   2. Re-emitting the header byte(s) with count+1.
 *   3. Concatenating the original body bytes after the header.
 *   4. Appending `cborUint(7)` + `cborBytes(auxDataHash)`.
 *
 * This works as long as WalletCore never produces a body map with > 23
 * entries (i.e. the count fits in the CBOR one-byte "additional info" form),
 * which is true in practice — current Cardano tx bodies have at most 9 keys.
 */
export function patchTxBodyWithAuxHash(txBodyCbor: Uint8Array, auxDataHash: Uint8Array): Uint8Array {
  if (txBodyCbor.length === 0) {
    throw new Error('patchTxBodyWithAuxHash: empty txBodyCbor')
  }

  const firstByte = txBodyCbor[0]!
  const majorType = firstByte >> 5
  if (majorType !== 5) {
    throw new Error(`patchTxBodyWithAuxHash: expected CBOR map (major type 5), got major type ${majorType}`)
  }

  const additionalInfo = firstByte & 0x1f
  if (additionalInfo >= 24) {
    // Multi-byte map count — would require a more complex header rewrite.
    // In practice Cardano tx bodies never exceed 23 entries.
    throw new Error(
      `patchTxBodyWithAuxHash: map header uses additional info ${additionalInfo}; only direct-count maps (< 24 entries) are supported`
    )
  }

  const oldCount = additionalInfo
  const newCount = oldCount + 1

  if (newCount >= 24) {
    throw new Error(
      `patchTxBodyWithAuxHash: cannot increment map count to ${newCount} (would overflow into two-byte header)`
    )
  }

  const newHeader = new Uint8Array([(5 << 5) | newCount])
  const bodyAfterHeader = txBodyCbor.slice(1)
  const auxHashEntry = new Uint8Array([...cborUint(7), ...cborBytes(auxDataHash)])

  const totalLen = newHeader.length + bodyAfterHeader.length + auxHashEntry.length
  const out = new Uint8Array(totalLen)
  let offset = 0
  out.set(newHeader, offset)
  offset += newHeader.length
  out.set(bodyAfterHeader, offset)
  offset += bodyAfterHeader.length
  out.set(auxHashEntry, offset)
  return out
}
