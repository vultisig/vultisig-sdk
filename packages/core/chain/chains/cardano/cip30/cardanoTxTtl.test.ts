import { describe, expect, it } from 'vitest'

import { getCardanoTxTtl } from './cardanoTxTtl'
import { cardanoCborEncoder } from './cborEncoder'

/**
 * Signed tx array [body, witness_set, is_valid, aux] whose body carries a
 * multiasset (token-bundle) output: value = [coin, { policyIdBytes =>
 * { assetNameBytes => qty } }]. Byte-string map keys are exactly what
 * cbor-x's default decode-to-object rejects ("Invalid property name type
 * object"), which aborted the broadcast of token-carrying txs at the TTL
 * freshness guard even though the tx was valid.
 */
const signedTxWithTokenChange = (ttl: number): Uint8Array => {
  const policyId = new Uint8Array(28).fill(0x9a)
  const assetName = new Uint8Array([0x53, 0x55, 0x4e, 0x44, 0x41, 0x45])
  const multiasset = new Map([[policyId, new Map([[assetName, 4_500_000]])]])
  const address = new Uint8Array(29).fill(0x61)

  const body = new Map<number, unknown>([
    [0, [[new Uint8Array(32).fill(0x11), 0]]], // inputs
    [
      1,
      [
        [address, 1_000_000], // plain recipient output
        [address, [2_000_000, multiasset]], // token-bundle change output
      ],
    ],
    [2, 200_000], // fee
    [3, ttl],
  ])

  return cardanoCborEncoder.encode([body, new Map(), true, null])
}

describe('getCardanoTxTtl', () => {
  it('reads the ttl from a plain signed tx', () => {
    const tx = cardanoCborEncoder.encode([new Map([[3, 500_000]]), new Map(), true, null])
    expect(getCardanoTxTtl(tx)).toBe(500_000n)
  })

  it('reads the ttl from a tx with a multiasset (byte-keyed) output', () => {
    expect(getCardanoTxTtl(signedTxWithTokenChange(123_456))).toBe(123_456n)
  })
})
