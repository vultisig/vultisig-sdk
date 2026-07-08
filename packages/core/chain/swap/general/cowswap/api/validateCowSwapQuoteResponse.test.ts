import { describe, expect, it } from 'vitest'

import { assertCowSwapQuoteMatchesRequest } from './validateCowSwapQuoteResponse'

// AGG-01 (audit r2): the CowSwap order copies sellToken/buyToken/kind/partiallyFillable from the /quote
// response into an EIP-712-signed + POSTed order. A compromised apiBase could substitute a token or flip
// kind. This guard asserts the response matches the request on those fund-critical fields before signing.
describe('assertCowSwapQuoteMatchesRequest (AGG-01)', () => {
  const req = {
    sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH (mixed case on purpose)
    buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    kind: 'sell' as const,
    partiallyFillable: false,
  }
  const matchingQuote = {
    sellToken: req.sellToken.toLowerCase(),
    buyToken: req.buyToken.toLowerCase(),
    kind: 'sell' as const,
    partiallyFillable: false,
  }

  it('passes when the response echoes the request (case-insensitive on addresses)', () => {
    expect(() => assertCowSwapQuoteMatchesRequest(matchingQuote, req)).not.toThrow()
  })

  it('THROWS when the API substitutes the buyToken (funds redirected to an attacker asset)', () => {
    expect(() =>
      assertCowSwapQuoteMatchesRequest(
        { ...matchingQuote, buyToken: '0x1111111111111111111111111111111111111111' },
        req
      )
    ).toThrow(/buyToken .* != requested/)
  })

  it('THROWS when the API substitutes the sellToken', () => {
    expect(() =>
      assertCowSwapQuoteMatchesRequest(
        { ...matchingQuote, sellToken: '0x2222222222222222222222222222222222222222' },
        req
      )
    ).toThrow(/sellToken .* != requested/)
  })

  it('THROWS when the API flips kind sell -> buy', () => {
    expect(() => assertCowSwapQuoteMatchesRequest({ ...matchingQuote, kind: 'buy' }, req)).toThrow(
      /kind buy != requested sell/
    )
  })

  it('THROWS when the API flips partiallyFillable', () => {
    expect(() => assertCowSwapQuoteMatchesRequest({ ...matchingQuote, partiallyFillable: true }, req)).toThrow(
      /partiallyFillable true != requested false/
    )
  })

  it('reports ALL mismatched fields in one throw', () => {
    expect(() =>
      assertCowSwapQuoteMatchesRequest(
        {
          sellToken: '0x2222222222222222222222222222222222222222',
          buyToken: '0x1111111111111111111111111111111111111111',
          kind: 'buy',
          partiallyFillable: true,
        },
        req
      )
    ).toThrow(/sellToken.*buyToken.*kind.*partiallyFillable/s)
  })
})
