import { OtherChain } from '@vultisig/core-chain/Chain'
import {
  parseRippleTokenId,
  rippleIssuedCurrencyDecimals,
  rippleKnownIssuedTokens,
  rippleTokenId,
} from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { areEqualCoins, CoinMetadata } from '@vultisig/core-chain/coin/Coin'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

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

/** XRPL token registry that maps a `<currency>:<issuer>` pair to community metadata. */
const xrplMetaBaseUrl = 'https://s1.xrplmeta.org'

type XrplMetaTokenResponse = {
  meta?: {
    token?: {
      icon?: string
    }
  }
}

/**
 * Official token icon from the XRPL token registry (xrplmeta), or `undefined`
 * when the token is unlisted or the registry is unreachable.
 *
 * XRPL issued currencies carry no on-ledger logo, so — as the EVM (1inch) and
 * Solana resolvers do for their chains — an arbitrary token borrows its logo
 * from a community registry, keyed by the `<currency>:<issuer>` pair. A registry
 * miss or outage is not an error here: the token still resolves, just without a
 * logo, so the lookup fails soft.
 */
const getRippleTokenIcon = async ({
  currency,
  issuer,
}: {
  currency: string
  issuer: string
}): Promise<string | undefined> => {
  const result = await attempt(() => queryUrl<XrplMetaTokenResponse>(`${xrplMetaBaseUrl}/token/${currency}:${issuer}`))

  if ('error' in result) {
    return undefined
  }

  return result.data.meta?.token?.icon || undefined
}

/**
 * Metadata for a custom XRPL issued currency identified by a `currency.issuer`
 * token id.
 *
 * XRPL issued currencies expose no on-ledger metadata call: issued amounts carry
 * no fixed on-chain decimal count (we model them at
 * {@link rippleIssuedCurrencyDecimals}) and the ticker is derived from the
 * currency code itself. A curated token keeps its bundled logo and price
 * provider; any other token borrows its official icon from the XRPL token
 * registry (falling back to no logo), but never a curated token's price — two
 * issuers can share a ticker on XRPL, so the issuer (encoded in the id) is what
 * actually distinguishes them.
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

  if (knownToken) {
    return {
      ...metadata,
      logo: knownToken.logo,
      priceProviderId: knownToken.priceProviderId,
    }
  }

  const logo = await getRippleTokenIcon({ currency, issuer })

  return logo ? { ...metadata, logo } : metadata
}
