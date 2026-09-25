import { describe, expect, it } from 'vitest'

import { getSolanaTxHash } from './solana'

describe('getSolanaTxHash', () => {
  it('returns the first signature string', () => {
    expect(
      getSolanaTxHash({
        signatures: [{ signature: '5abcSignatureBase58' }],
      } as never)
    ).toBe('5abcSignatureBase58')
  })

  it('throws when no signature is present', () => {
    expect(() => getSolanaTxHash({ signatures: [] } as never)).toThrow()
  })
})
