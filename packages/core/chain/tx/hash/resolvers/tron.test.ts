import { TW } from '@trustwallet/wallet-core'
import { describe, expect, it } from 'vitest'

import { getTronTxHash } from './tron'

describe('getTronTxHash', () => {
  it('returns the id bytes as lowercase hex without a prefix, preserving leading zeros', () => {
    const output = TW.Tron.Proto.SigningOutput.create({
      id: Uint8Array.from([0, 1, 15, 16, 171, 255]),
      signature: Uint8Array.from([99]),
    })
    expect(getTronTxHash(output)).toBe('00010f10abff')
  })
  it('returns an empty string for an empty id', () => {
    expect(getTronTxHash(TW.Tron.Proto.SigningOutput.create())).toBe('')
  })
})
