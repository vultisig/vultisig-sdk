import { Encoder } from 'cbor-x'

/**
 * Shared CBOR encoder configured for Cardano's wire format.
 *
 * - `mapsAsObjects: false` keeps JS `Map` objects as true CBOR maps (Cardano
 *   multiasset uses byte-string and integer keys, not text keys).
 * - `tagUint8Array: false` strips the cbor-x specific `d840` tag so byte
 *   strings round-trip as plain CBOR major type 2.
 */
export const cardanoCborEncoder = new Encoder({
  mapsAsObjects: false,
  tagUint8Array: false,
})
