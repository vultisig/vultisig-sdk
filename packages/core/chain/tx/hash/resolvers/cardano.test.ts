import { blake2b } from '@noble/hashes/blake2b'
import { describe, expect, it } from 'vitest'

import { cardanoCborEncoder } from '@vultisig/core-chain/chains/cardano/cip30/cborEncoder'

import { getCardanoTxHash } from './cardano'

describe('getCardanoTxHash', () => {
  it('prefers a precomputed txId over re-encoding', () => {
    const txId = Uint8Array.from([0xaa, 0xbb, 0xcc])
    expect(getCardanoTxHash({ txId, encoded: new Uint8Array([0xff]) } as never)).toBe('aabbcc')
  })

  it('falls back to blake2b-256 of the CBOR body when txId is empty', () => {
    const body = new Uint8Array([0x01, 0x02, 0x03])
    const encoded = cardanoCborEncoder.encode([body, new Uint8Array([0x00])])
    const decoded = cardanoCborEncoder.decode(encoded)
    const expected = Buffer.from(blake2b(cardanoCborEncoder.encode(decoded[0]), { dkLen: 32 })).toString('hex')

    expect(getCardanoTxHash({ txId: new Uint8Array(), encoded } as never)).toBe(expected)
  })
})
