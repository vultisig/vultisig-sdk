import { describe, expect, it } from 'vitest'

import { Chain } from '../../Chain'
import { rippleTokenId } from '../../chains/ripple/issuedCurrency'
import { getKnownTokenById, getKnownTokenIndexId, knownTokensIndex } from '.'

describe('knownTokens chain-sensitive lookup', () => {
  const ethereumUsdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  const solanaUsdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  const rippleRlusd = rippleTokenId({
    currency: 'RLUSD',
    issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
  })

  it('normalizes only EVM ids for indexing', () => {
    expect(getKnownTokenIndexId(Chain.Ethereum, ethereumUsdc)).toBe(ethereumUsdc.toLowerCase())
    expect(getKnownTokenIndexId(Chain.Solana, solanaUsdc)).toBe(solanaUsdc)
    expect(getKnownTokenIndexId(Chain.Ripple, rippleRlusd)).toBe(rippleRlusd)
  })

  it('keeps Ethereum lookups case-insensitive', () => {
    expect(getKnownTokenById(Chain.Ethereum, ethereumUsdc)?.ticker).toBe('USDC')
    expect(getKnownTokenById(Chain.Ethereum, ethereumUsdc.toLowerCase())?.ticker).toBe('USDC')
  })

  it('requires exact canonical ids for Solana and Ripple', () => {
    expect(knownTokensIndex[Chain.Solana][solanaUsdc]?.ticker).toBe('USDC')
    expect(knownTokensIndex[Chain.Solana][solanaUsdc.toLowerCase()]).toBeUndefined()
    expect(getKnownTokenById(Chain.Solana, solanaUsdc)?.ticker).toBe('USDC')
    expect(getKnownTokenById(Chain.Solana, solanaUsdc.toLowerCase())).toBeUndefined()

    expect(getKnownTokenById(Chain.Ripple, rippleRlusd)?.ticker).toBe('RLUSD')
    expect(getKnownTokenById(Chain.Ripple, rippleRlusd.toLowerCase())).toBeUndefined()
  })
})
