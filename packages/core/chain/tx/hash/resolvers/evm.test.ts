import { describe, expect, it } from 'vitest'
import { keccak256 } from 'viem'

import { getEvmTxHash } from './evm'

describe('getEvmTxHash', () => {
  it('returns keccak256 of the signed encoded payload', () => {
    const encoded = new Uint8Array([0x02, 0xf8, 0x6c, 0x01])
    expect(getEvmTxHash({ encoded } as never)).toBe(keccak256(encoded))
  })

  it('is deterministic for the same encoded bytes', () => {
    const encoded = new Uint8Array(64).fill(0xab)
    expect(getEvmTxHash({ encoded } as never)).toBe(getEvmTxHash({ encoded } as never))
  })
})
