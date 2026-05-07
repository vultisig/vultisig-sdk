import { id, Interface } from 'ethers'
import { describe, expect, it } from 'vitest'

import { commonEvmSelectors, type EvmActionLabel, lookupCommonEvmSelector } from './commonSelectors'

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

  it('every signature is parseable as a function fragment by ethers', () => {
    // Guards against e.g. malformed tuple syntax in V3/UR entries that would
    // hash correctly but fail to decode at runtime.
    for (const entry of Object.values(commonEvmSelectors)) {
      expect(() => new Interface([`function ${entry.signature}`])).not.toThrow()
    }
  })

  it('every declared action label is used by at least one selector', () => {
    const declared: EvmActionLabel[] = [
      'Token Approval',
      'Token Transfer',
      'Token Swap',
      'Cross-Chain Swap',
      'Wrap ETH',
      'Unwrap WETH',
      'Stake',
      'Claim Rewards',
      'Exit Stake',
      'Lending Supply',
      'Lending Withdraw',
      'NFT Transfer',
      'Multicall',
    ]
    const used = new Set(Object.values(commonEvmSelectors).map(e => e.actionLabel))
    for (const label of declared) {
      expect(used.has(label)).toBe(true)
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
