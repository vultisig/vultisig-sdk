import { OtherChain } from '@vultisig/core-chain/Chain'
import { getRippleAccountLines } from '@vultisig/core-chain/chains/ripple/account/lines'
import {
  parseIssuedCurrencyValue,
  rippleIssuedCurrencyDecimals,
  rippleKnownIssuedTokens,
  rippleTokenId,
} from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { areEqualCoins } from '@vultisig/core-chain/coin/Coin'
import { FindCoinsResolver } from '@vultisig/core-chain/coin/find/resolver'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'

/**
 * Human-readable ticker for a trust line. Standard 3-character codes (`USD`) are
 * already tickers; the 160-bit hex form encodes ASCII right-padded with zeros, so
 * decoding it recovers the ticker a user would recognise (e.g. `RLUSD`).
 */
const toIssuedCurrencyTicker = (currency: string): string => {
  if (currency.length !== 40) {
    return currency
  }

  const ascii = Buffer.from(currency, 'hex').toString('ascii').replace(/\0+$/, '')

  return /^[\x20-\x7e]+$/.test(ascii) ? ascii : currency
}

/**
 * Discovers XRPL issued currencies (trust-line tokens) held at `address`.
 *
 * Only lines with a strictly positive balance are surfaced: a negative balance means
 * the account is the token's issuer and owes the counterparty rather than holding it,
 * and a zero balance is an open-but-empty trust line that would only clutter the
 * asset list.
 */
export const findRippleCoins: FindCoinsResolver<OtherChain.Ripple> = async ({ address, chain }) => {
  const linesResult = await attempt(getRippleAccountLines(address))

  if ('error' in linesResult) {
    // An unfunded account simply holds no trust lines.
    if (isInError(linesResult.error, 'Account not found', 'actNotFound')) {
      return []
    }

    throw linesResult.error
  }

  return linesResult.data
    .filter(({ balance }) => parseIssuedCurrencyValue(balance) > 0)
    .map(({ account, currency }) => {
      const coin = {
        id: rippleTokenId({ currency, issuer: account }),
        chain,
        address,
        ticker: toIssuedCurrencyTicker(currency),
        decimals: rippleIssuedCurrencyDecimals,
      }

      // Prefer curated metadata (logo, price provider) when we know the token.
      const knownToken = rippleKnownIssuedTokens.find(token => areEqualCoins(token, coin))

      return knownToken ? { ...coin, ...knownToken, address } : coin
    })
}
