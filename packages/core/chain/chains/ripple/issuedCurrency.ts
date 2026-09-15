import { Chain } from '@vultisig/core-chain/Chain'
import { KnownCoin } from '@vultisig/core-chain/coin/Coin'
import { isValidClassicAddress } from 'ripple-address-codec'

/**
 * Owner-reserve locked by each XRP Ledger object a wallet owns, including every
 * trust line. Opening a trust line raises the account's required reserve by this
 * amount (it is locked, not spent). Current mainnet value is 0.2 XRP.
 * @see https://xrpl.org/docs/concepts/accounts/reserves
 */
export const rippleOwnerReserveDrops = 200000n

/** XRPL "standard" (ISO-4217-like) currency codes are exactly 3 characters. */
const standardCurrencyCodeLength = 3

/** Non-standard XRPL currency codes are a 160-bit value, i.e. 40 hex chars. */
const hexCurrencyCodeLength = 40

const hexCurrencyCodeRegex = /^[0-9a-fA-F]{40}$/

/**
 * Characters XRPL permits inside a 3-character standard currency code. Both
 * letter cases are legal on the ledger, so `usd` is a distinct currency from
 * `USD` rather than a malformed code.
 * @see https://xrpl.org/docs/references/protocol/data-types/currency-formats
 */
const standardCurrencyCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789<>(){}[]|?!@#$%^&*'

/**
 * Codes the ledger reserves for native XRP. Compared case-insensitively so a
 * lookalike such as `xrp` cannot be signed as though it were a token.
 */
const nativeCurrencyCodes = ['XRP', '0'.repeat(40), '0000000000000000000000005852500000000000']

const asciiToHexCurrencyCode = (currency: string): string => {
  const bytes = [...currency].map(character => {
    const code = character.charCodeAt(0)
    if (code > 127) {
      throw new Error('Unsupported XRP issued-currency code: expected ASCII or a 160-bit hex code')
    }

    return code
  })
  if (bytes.length > 20) {
    throw new Error(`XRPL currency code too long: "${currency}" (max 20 bytes)`)
  }

  return [...bytes, ...Array<number>(20 - bytes.length).fill(0)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/**
 * Normalises a human currency ticker to the on-ledger XRPL currency code.
 *
 * - 3-character codes (e.g. `USD`) are standard codes and are used verbatim.
 * - An already-encoded 40-char hex code passes through (upper-cased).
 * - Anything else (e.g. `RLUSD`) is encoded as the 160-bit form: the ASCII bytes
 *   right-padded with zeros to 20 bytes, hex-encoded. This is what the XRP Ledger
 *   and WalletCore's Ripple signer expect for non-standard currencies.
 */
export const toXrplCurrencyCode = (currency: string): string => {
  const value = currency.trim()

  if (value.length === standardCurrencyCodeLength) {
    return value
  }

  if (value.length === hexCurrencyCodeLength && hexCurrencyCodeRegex.test(value)) {
    return value.toUpperCase()
  }

  return asciiToHexCurrencyCode(value)
}

/**
 * True if `currency` is already a valid on-ledger XRPL currency code: either a
 * 3-character standard code or the 40-char hex (160-bit) non-standard form.
 * A human ticker like `RLUSD` is NOT valid here - it must first be normalised
 * via {@link toXrplCurrencyCode} before being used in a token id or TrustSet.
 */
export const isValidXrplCurrencyCode = (currency: string): boolean =>
  currency.length === standardCurrencyCodeLength ||
  (currency.length === hexCurrencyCodeLength && hexCurrencyCodeRegex.test(currency))

const tokenIdSeparator = '.'

type RippleIssuedCurrency = {
  currency: string
  issuer: string
}

/**
 * Composite identifier for an XRPL issued currency: `<currencyCode>.<issuer>`.
 * XRPL tokens are identified by the (currency, issuer) pair rather than a single
 * contract address, so both are encoded into the coin `id`.
 */
export const rippleTokenId = ({ currency, issuer }: RippleIssuedCurrency): string =>
  `${toXrplCurrencyCode(currency)}${tokenIdSeparator}${issuer}`

/** Splits a {@link rippleTokenId} back into its `currency` code and `issuer`. */
export const parseRippleTokenId = (id: string): RippleIssuedCurrency => {
  const index = id.indexOf(tokenIdSeparator)
  if (index <= 0 || index === id.length - 1) {
    throw new Error(`Invalid Ripple token id: "${id}"`)
  }

  return {
    currency: id.slice(0, index),
    issuer: id.slice(index + 1),
  }
}

/**
 * Formats an issued-currency base-unit amount as an XRPL value string: a plain
 * decimal (never scientific notation) with trailing-zero fractional digits
 * trimmed. This formats values for display; use getSignableIssuedCurrencyAmount
 * when the value must be exactly representable on the ledger.
 */
export const formatIssuedCurrencyValue = (amount: bigint, decimals: number): string => {
  const negative = amount < 0n
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, '0')

  const intPart = digits.slice(0, digits.length - decimals) || '0'
  const fracPart = decimals > 0 ? digits.slice(digits.length - decimals).replace(/0+$/, '') : ''

  const magnitude = fracPart ? `${intPart}.${fracPart}` : intPart

  return negative && magnitude !== '0' ? `-${magnitude}` : magnitude
}

/** Construct an issued amount without letting a signer change its asset or round its value. */
export const getSignableIssuedCurrencyAmount = ({
  currency,
  issuer,
  amount,
  decimals,
}: RippleIssuedCurrency & { amount: bigint; decimals: number }) => {
  if ([...currency].some(character => character.charCodeAt(0) > 127)) {
    throw new Error('Unsupported XRP issued-currency code: expected ASCII or a 160-bit hex code')
  }
  const code = toXrplCurrencyCode(currency)
  const standardCode =
    code.length === standardCurrencyCodeLength &&
    [...code].every(character => standardCurrencyCharacters.includes(character))
  if ((!standardCode && !hexCurrencyCodeRegex.test(code)) || nativeCurrencyCodes.includes(code.toUpperCase())) {
    throw new Error('Unsupported XRP issued-currency code: signing must preserve its exact identity')
  }
  if (!isValidClassicAddress(issuer)) {
    throw new Error('Invalid XRP issued-currency issuer address')
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 96 || amount < 0n) {
    throw new Error('Invalid XRP issued-currency amount or decimal scale')
  }
  // XRPL uses a 16-digit mantissa and exponent [-96, 80]. Reject rather than
  // silently truncating a quantity that the user already reviewed.
  const digits = amount.toString()
  const significantDigits = digits.replace(/0+$/, '').length
  const magnitude = digits.length - decimals - 1
  if (amount !== 0n && (significantDigits > 16 || magnitude < -81 || magnitude > 95)) {
    throw new Error('XRP issued-currency amount is not exactly representable (maximum 16 significant digits)')
  }
  // WalletCore checks the exponent after trimming trailing zeroes, before
  // padding the mantissa to 16 digits. Keep all signers within that supported
  // subset and reject unsupported values before review, not during signing.
  const trimmedExponent = digits.length - significantDigits - decimals
  if (amount !== 0n && trimmedExponent > 80) {
    throw new Error('XRP issued-currency amount exceeds the supported signer exponent')
  }
  return {
    currency: code,
    issuer,
    value: formatIssuedCurrencyValue(amount, decimals),
  }
}

/**
 * XRPL issued currencies carry up to 16 significant decimal digits rather than a
 * fixed on-chain decimal count. Our fixed-point balance model uses 15 decimals.
 */
export const rippleIssuedCurrencyDecimals = 15

/**
 * Parses an XRPL issued-currency value string (as returned by `account_lines`)
 * into a base-unit bigint at {@link rippleIssuedCurrencyDecimals}. The inverse of
 * {@link formatIssuedCurrencyValue}.
 *
 * The ledger may return scientific notation (e.g. `1e-8`) as well as plain
 * decimals, and values are signed — a negative balance means the account is the
 * issuer of the line rather than a holder of it.
 *
 * Fractional digits beyond our modelled precision are truncated, never rounded
 * up, so a dust balance can never be inflated into a larger holding.
 */
export const parseIssuedCurrencyValue = (value: string): bigint => {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.trim())
  if (!match) {
    throw new Error(`Invalid XRPL issued-currency value: "${value}"`)
  }

  const [, sign, intPart, fracPart = '', exponent = '0'] = match

  // The literal is `digits * 10^(exponent - fracPart.length)`, so scaling it to
  // base units shifts by that plus our modelled decimals. Shifting the digit
  // string rather than round-tripping through a float keeps full precision.
  const shift = Number(exponent) - fracPart.length + rippleIssuedCurrencyDecimals
  const digits = BigInt(`${intPart}${fracPart}`)

  const magnitude = shift >= 0 ? digits * 10n ** BigInt(shift) : digits / 10n ** BigInt(-shift)

  return sign === '-' ? -magnitude : magnitude
}

/**
 * Curated XRPL issued tokens, surfaced both in the "open trust line" flow and —
 * via `knownTokens` — in the asset list. Trust lines the account already holds are
 * discovered from the ledger by the Ripple coin finder; this list is what a user
 * can pick before any trust line exists.
 */
export const rippleKnownIssuedTokens: KnownCoin[] = [
  {
    chain: Chain.Ripple,
    id: rippleTokenId({
      currency: 'RLUSD',
      issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
    }),
    ticker: 'RLUSD',
    logo: 'rlusd',
    decimals: rippleIssuedCurrencyDecimals,
    priceProviderId: 'ripple-usd',
  },
]
