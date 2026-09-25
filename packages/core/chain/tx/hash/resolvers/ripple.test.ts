import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ hashSignedTx: vi.fn() }))

vi.mock('xrpl', () => ({
  hashes: { hashSignedTx: mocks.hashSignedTx },
}))

import { getRippleTxHash } from './ripple'

describe('getRippleTxHash', () => {
  beforeEach(() => mocks.hashSignedTx.mockReset())

  it('passes the encoded blob as hex to xrpl.hashSignedTx', () => {
    mocks.hashSignedTx.mockReturnValueOnce('DEADBEEF')
    const encoded = Uint8Array.from([0x12, 0xab])
    expect(getRippleTxHash({ encoded } as never)).toBe('DEADBEEF')
    expect(mocks.hashSignedTx).toHaveBeenCalledWith('12ab')
  })
})
