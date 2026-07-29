import { OtherChain } from '@vultisig/core-chain/Chain'
import {
  parseRippleTokenId,
  rippleIssuedCurrencyDecimals,
  rippleKnownIssuedTokens,
  rippleTokenId,
} from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { areEqualCoins, CoinMetadata } from '@vultisig/core-chain/coin/Coin'

import { TokenMetadataResolver } from '../resolver'

/**
 * Human-readable ticker for an XRPL issued currency. Standard 3-character codes
 * (`USD`) are already tickers; the 160-bit hex form encodes ASCII right-padded
 * with zeros, so decoding it recovers the ticker a user recognises (e.g. `RLUSD`).
 */
const toIssuedCurrencyTicker = (currency: string): string => {
  if (currency.length !== 40) {
    return currency
  }

  const ascii = Buffer.from(currency, 'hex').toString('ascii').replace(/\0+$/, '')

  return /^[\x20-\x7e]+$/.test(ascii) ? ascii : currency
}

/**
 * Metadata for a custom XRPL issued currency identified by a `currency.issuer`
 * token id.
 *
 * Unlike EVM/Tron tokens, XRPL issued currencies expose no on-ledger metadata
 * call: issued amounts carry no fixed on-chain decimal count (we model them at
 * {@link rippleIssuedCurrencyDecimals}) and the ticker is derived from the
 * currency code itself, so nothing is fetched. When the token is one we curate,
 * its logo and price provider are merged in; an arbitrary token gets neither, so
 * it renders with a generic icon and no price rather than borrowing a known
 * token's identity — two different issuers can share a ticker on XRPL, so the
 * issuer (encoded in the id) is what actually distinguishes them.
 */
export const getRippleTokenMetadata: TokenMetadataResolver<OtherChain.Ripple> = async ({ id, chain }) => {
  const { currency, issuer } = parseRippleTokenId(id)

  const metadata: CoinMetadata = {
    ticker: toIssuedCurrencyTicker(currency),
    decimals: rippleIssuedCurrencyDecimals,
  }

  const knownToken = rippleKnownIssuedTokens.find(token =>
    areEqualCoins(token, { chain, id: rippleTokenId({ currency, issuer }) })
  )

  if (!knownToken) {
    return metadata
  }

  return {
    ...metadata,
    logo: knownToken.logo,
    priceProviderId: knownToken.priceProviderId,
  }
}
