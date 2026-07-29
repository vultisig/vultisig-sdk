import { Chain } from '@vultisig/core-chain/Chain'
import { rippleIssuedCurrencyDecimals, rippleTokenId } from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { describe, expect, it } from 'vitest'

import { getRippleTokenMetadata } from './ripple'

const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'
const SOLO_ISSUER = 'rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz'

describe('getRippleTokenMetadata', () => {
  it('enriches a curated token (RLUSD) with its logo and price provider', async () => {
    const id = rippleTokenId({ currency: 'RLUSD', issuer: RLUSD_ISSUER })

    await expect(getRippleTokenMetadata({ chain: Chain.Ripple, id })).resolves.toEqual({
      ticker: 'RLUSD',
      decimals: rippleIssuedCurrencyDecimals,
      logo: 'rlusd',
      priceProviderId: 'ripple-usd',
    })
  })

  it('derives ticker/decimals for an arbitrary token, with no logo or price', async () => {
    const id = rippleTokenId({ currency: 'SOLO', issuer: SOLO_ISSUER })

    await expect(getRippleTokenMetadata({ chain: Chain.Ripple, id })).resolves.toEqual({
      ticker: 'SOLO',
      decimals: rippleIssuedCurrencyDecimals,
    })
  })

  it('keeps a standard 3-character currency code as the ticker', async () => {
    const id = rippleTokenId({ currency: 'USD', issuer: RLUSD_ISSUER })

    await expect(getRippleTokenMetadata({ chain: Chain.Ripple, id })).resolves.toEqual({
      ticker: 'USD',
      decimals: rippleIssuedCurrencyDecimals,
    })
  })
})
