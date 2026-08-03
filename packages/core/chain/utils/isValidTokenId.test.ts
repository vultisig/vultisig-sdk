import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { rippleTokenId } from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { beforeAll, describe, expect, it } from 'vitest'

import { isValidTokenId, normalizeTokenId } from './isValidTokenId'

const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'
const SOLO_ISSUER = 'rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz'

describe('isValidTokenId - Ripple issued currencies', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('accepts a non-standard currency ticker (e.g. "RLUSD.<issuer>") — the form shown on explorers', () => {
    expect(
      isValidTokenId({
        chain: Chain.Ripple,
        id: `RLUSD.${RLUSD_ISSUER}`,
        walletCore,
      })
    ).toBe(true)
  })

  it('accepts a properly encoded (40-char hex) non-standard currency id', () => {
    const id = rippleTokenId({ currency: 'RLUSD', issuer: RLUSD_ISSUER })

    expect(id).toBe(`524C555344000000000000000000000000000000.${RLUSD_ISSUER}`)
    expect(
      isValidTokenId({
        chain: Chain.Ripple,
        id,
        walletCore,
      })
    ).toBe(true)
  })

  it('accepts a standard 3-character currency code', () => {
    expect(
      isValidTokenId({
        chain: Chain.Ripple,
        id: `USD.${RLUSD_ISSUER}`,
        walletCore,
      })
    ).toBe(true)
  })

  it('rejects a currency name longer than 20 bytes (cannot be encoded)', () => {
    expect(
      isValidTokenId({
        chain: Chain.Ripple,
        id: `THIS_TICKER_IS_WAY_TOO_LONG.${RLUSD_ISSUER}`,
        walletCore,
      })
    ).toBe(false)
  })

  it('rejects a valid currency paired with an invalid issuer address', () => {
    expect(
      isValidTokenId({
        chain: Chain.Ripple,
        id: 'USD.not-a-valid-xrpl-address',
        walletCore,
      })
    ).toBe(false)
  })

  it('rejects an id without a currency/issuer separator', () => {
    expect(
      isValidTokenId({
        chain: Chain.Ripple,
        id: RLUSD_ISSUER,
        walletCore,
      })
    ).toBe(false)
  })
})

describe('normalizeTokenId - Ripple issued currencies', () => {
  it('canonicalises a human ticker to its on-ledger (40-hex) currency code', () => {
    expect(normalizeTokenId({ chain: Chain.Ripple, id: `SOLO.${SOLO_ISSUER}` })).toBe(
      `534F4C4F00000000000000000000000000000000.${SOLO_ISSUER}`
    )
    expect(normalizeTokenId({ chain: Chain.Ripple, id: `RLUSD.${RLUSD_ISSUER}` })).toBe(
      `524C555344000000000000000000000000000000.${RLUSD_ISSUER}`
    )
  })

  it('produces the same id auto-discovery does, so a manual add dedupes', () => {
    expect(normalizeTokenId({ chain: Chain.Ripple, id: `SOLO.${SOLO_ISSUER}` })).toBe(
      rippleTokenId({ currency: 'SOLO', issuer: SOLO_ISSUER })
    )
  })

  it('leaves a standard 3-character code and an already-encoded id unchanged', () => {
    expect(normalizeTokenId({ chain: Chain.Ripple, id: `USD.${RLUSD_ISSUER}` })).toBe(`USD.${RLUSD_ISSUER}`)

    const encoded = rippleTokenId({ currency: 'SOLO', issuer: SOLO_ISSUER })
    expect(normalizeTokenId({ chain: Chain.Ripple, id: encoded })).toBe(encoded)
  })

  it('returns a malformed id unchanged (validation rejects it separately)', () => {
    expect(normalizeTokenId({ chain: Chain.Ripple, id: 'garbage' })).toBe('garbage')
  })

  it('leaves non-Ripple ids untouched', () => {
    const evmToken = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    expect(normalizeTokenId({ chain: Chain.Ethereum, id: evmToken })).toBe(evmToken)
  })
})
