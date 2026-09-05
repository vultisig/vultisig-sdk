import { toXrplCurrencyCode } from '@vultisig/core-chain/chains/ripple/issuedCurrency'

/** The `account_lines` fields that say which asset a trust line is for. */
export type RippleTrustLineAsset = {
  /** The line's counterparty — the issuer, from the holder's perspective. */
  account: string
  currency: string
}

type FindRippleTrustLineInput<T extends RippleTrustLineAsset> = {
  lines: T[]
  currency: string
  issuer: string
}

/**
 * The trust line among `lines` that holds `(currency, issuer)`, or `undefined`
 * when the account has none.
 *
 * Currency codes are compared normalised, so a node spelling a non-standard code
 * in lowercase hex still matches a token id that holds it uppercased. Issuer
 * addresses are base58 and compared case-SENSITIVELY.
 */
export const findRippleTrustLine = <T extends RippleTrustLineAsset>({
  lines,
  currency,
  issuer,
}: FindRippleTrustLineInput<T>): T | undefined => {
  const code = toXrplCurrencyCode(currency)

  return lines.find(line => line.account === issuer && toXrplCurrencyCode(line.currency) === code)
}
