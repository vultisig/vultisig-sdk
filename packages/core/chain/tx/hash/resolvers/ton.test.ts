import { describe, expect, it } from 'vitest'

import { getTonTxHash } from './ton'

describe('getTonTxHash', () => {
  it('hex-encodes the WalletCore hash bytes', () => {
    const hash = Uint8Array.from([0xde, 0xad, 0xbe, 0xef])
    expect(getTonTxHash({ hash } as never)).toBe('deadbeef')
  })

  it('returns an empty string for an empty hash', () => {
    expect(getTonTxHash({ hash: new Uint8Array() } as never)).toBe('')
  })
})
