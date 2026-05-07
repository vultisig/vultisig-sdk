import { id } from 'ethers'
import { describe, expect, it } from 'vitest'

import { commonEvmSelectors, lookupCommonEvmSelector } from './commonSelectors'

describe('commonEvmSelectors', () => {
  it('every entry maps to keccak256(signature)[:4]', () => {
    for (const [selector, entry] of Object.entries(commonEvmSelectors)) {
      const computed = id(entry.signature).slice(0, 10)
      expect(computed).toBe(selector)
    }
  })

  it('selector keys are lowercase 0x-prefixed 8-hex-char strings', () => {
    for (const selector of Object.keys(commonEvmSelectors)) {
      expect(selector).toMatch(/^0x[0-9a-f]{8}$/)
    }
  })
})

describe('lookupCommonEvmSelector', () => {
  it('finds known selectors', () => {
    expect(lookupCommonEvmSelector('0x095ea7b3')).toEqual({
      signature: 'approve(address,uint256)',
      actionLabel: 'Token Approval',
    })
    expect(lookupCommonEvmSelector('0xa9059cbb')).toEqual({
      signature: 'transfer(address,uint256)',
      actionLabel: 'Token Transfer',
    })
  })

  it('is case-insensitive', () => {
    expect(lookupCommonEvmSelector('0x095EA7B3')?.actionLabel).toBe('Token Approval')
  })

  it('returns null for unknown selectors', () => {
    expect(lookupCommonEvmSelector('0xdeadbeef')).toBeNull()
  })
})
