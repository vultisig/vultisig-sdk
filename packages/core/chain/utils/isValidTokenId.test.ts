import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { rippleTokenId } from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { beforeAll, describe, expect, it } from 'vitest'

import { isValidTokenId } from './isValidTokenId'

const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'

describe('isValidTokenId - Ripple issued currencies', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('rejects an unencoded non-standard currency ticker (e.g. "RLUSD.<issuer>")', () => {
    expect(
      isValidTokenId({
        chain: Chain.Ripple,
        id: `RLUSD.${RLUSD_ISSUER}`,
        walletCore,
      })
    ).toBe(false)
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

  it('rejects a valid currency paired with an invalid issuer address', () => {
    expect(
      isValidTokenId({
        chain: Chain.Ripple,
        id: 'USD.not-a-valid-xrpl-address',
        walletCore,
      })
    ).toBe(false)
  })
})
