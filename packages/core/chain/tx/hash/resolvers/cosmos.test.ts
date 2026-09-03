import { toBase64 } from '@cosmjs/encoding'
import { describe, expect, it } from 'vitest'
import { sha256 } from 'viem'

import { getCosmosTxHash } from './cosmos'

const txBytes = new Uint8Array([0x0a, 0x04, 0x74, 0x65, 0x73, 0x74])
const txBytesB64 = toBase64(txBytes)
const expected = sha256(txBytes).slice(2).toUpperCase()

describe('getCosmosTxHash', () => {
  it('hashes serialized.tx_bytes (base64) with sha256 and uppercases hex', () => {
    expect(getCosmosTxHash({ serialized: JSON.stringify({ tx_bytes: txBytesB64 }) } as never)).toBe(expected)
  })

  it('accepts the json field as a fallback when serialized is absent', () => {
    expect(getCosmosTxHash({ json: JSON.stringify({ tx_bytes: txBytesB64 }) } as never)).toBe(expected)
  })

  it('throws when neither serialized nor json carries tx_bytes', () => {
    expect(() => getCosmosTxHash({} as never)).toThrow(/Serialized Cosmos transaction data is missing/)
  })
})
