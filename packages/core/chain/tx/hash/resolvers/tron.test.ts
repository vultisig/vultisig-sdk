import { describe, expect, it } from 'vitest'

import { getTronTxHash } from './tron'

describe('getTronTxHash', () => {
  it('hex-encodes the tx id without a 0x prefix', () => {
    const id = Uint8Array.from([0x0a, 0xbc, 0xde])
    expect(getTronTxHash({ id } as never)).toBe('0abcde')
  })
})
