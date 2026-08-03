import { Chain } from '@vultisig/core-chain/Chain'
import { rippleIssuedCurrencyDecimals, rippleTokenId } from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getRippleTokenMetadata } from './ripple'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'
const SOLO_ISSUER = 'rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz'
const SOLO_ICON = 'https://s2.xrplmeta.org/icon/C40439709A.png'

const mockIcon = (icon: string | undefined) => {
  vi.mocked(queryUrl).mockResolvedValue({ meta: { token: { icon } } } as never)
}

describe('getRippleTokenMetadata', () => {
  beforeEach(() => {
    vi.mocked(queryUrl).mockReset()
    mockIcon(undefined)
  })

  it('enriches a curated token (RLUSD) with its bundled logo and price provider', async () => {
    const id = rippleTokenId({ currency: 'RLUSD', issuer: RLUSD_ISSUER })

    await expect(getRippleTokenMetadata({ chain: Chain.Ripple, id })).resolves.toEqual({
      ticker: 'RLUSD',
      decimals: rippleIssuedCurrencyDecimals,
      logo: 'rlusd',
      priceProviderId: 'ripple-usd',
    })
  })

  it('does not query the registry for a curated token', async () => {
    const id = rippleTokenId({ currency: 'RLUSD', issuer: RLUSD_ISSUER })

    await getRippleTokenMetadata({ chain: Chain.Ripple, id })

    expect(queryUrl).not.toHaveBeenCalled()
  })

  it('gives an arbitrary token its registry icon', async () => {
    mockIcon(SOLO_ICON)
    const id = rippleTokenId({ currency: 'SOLO', issuer: SOLO_ISSUER })

    await expect(getRippleTokenMetadata({ chain: Chain.Ripple, id })).resolves.toEqual({
      ticker: 'SOLO',
      decimals: rippleIssuedCurrencyDecimals,
      logo: SOLO_ICON,
    })
  })

  it('looks the token up by its currency and issuer pair', async () => {
    const id = rippleTokenId({ currency: 'SOLO', issuer: SOLO_ISSUER })

    await getRippleTokenMetadata({ chain: Chain.Ripple, id })

    // Two issuers can share a ticker, so the issuer has to be part of the key.
    expect(vi.mocked(queryUrl).mock.calls[0][0]).toContain(`:${SOLO_ISSUER}`)
  })

  it('never gives an arbitrary token a price provider', async () => {
    mockIcon(SOLO_ICON)
    const id = rippleTokenId({ currency: 'SOLO', issuer: SOLO_ISSUER })

    const metadata = await getRippleTokenMetadata({ chain: Chain.Ripple, id })

    // A logo it may borrow; a curated token's pricing it may not.
    expect(metadata).not.toHaveProperty('priceProviderId')
  })

  it('resolves without a logo when the token is unlisted', async () => {
    const id = rippleTokenId({ currency: 'SOLO', issuer: SOLO_ISSUER })

    await expect(getRippleTokenMetadata({ chain: Chain.Ripple, id })).resolves.toEqual({
      ticker: 'SOLO',
      decimals: rippleIssuedCurrencyDecimals,
    })
  })

  it('resolves without a logo when the registry is unreachable', async () => {
    // The token still resolves — a registry outage is not a metadata failure.
    vi.mocked(queryUrl).mockRejectedValue(new Error('network down'))
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
