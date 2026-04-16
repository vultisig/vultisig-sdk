import { Chain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { getErc20Prices } from '@vultisig/core-chain/coin/price/evm/getErc20Prices'
import { getCoinPrices } from '@vultisig/core-chain/coin/price/getCoinPrices'
import { fiatCurrencies, type FiatCurrency } from '@vultisig/core-config/FiatCurrency'

/** Thrown when a fiat -> token amount conversion fails. Message is LLM-readable. */
export class FiatToAmountError extends Error {
  override readonly name = 'FiatToAmountError'

  constructor(message: string) {
    super(message)
  }
}

const fiatCurrencySet = new Set<string>(fiatCurrencies)

export type FiatToAmountParams = {
  /** Fiat value to convert (e.g. 100 for $100). Must be a positive number or numeric string. */
  fiatValue: number | string
  /** Chain the token lives on. */
  chain: Chain
  /** Optional token contract address (EVM only). Omit for native coin. */
  tokenId?: string
  /** Token decimals (used to cap fractional-digit precision of the return string). */
  decimals: number
  /** Fiat currency code (defaults to "USD"). Normalized to lowercase before lookup. */
  fiatCurrency?: FiatCurrency | string
}

const parseFiatValue = (v: number | string): number => {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) {
    throw new FiatToAmountError(`Invalid fiat value "${v}" — must be a positive number.`)
  }
  return n
}

// Prefer value.toString() — JS picks the shortest round-trip representation, so clean
// values like 0.05 stay "0.05" instead of surfacing float artefacts ("0.050000000000000003").
// Fall back to toFixed only to expand scientific notation (e.g. 1e-10). Then cap fractional
// digits and trim trailing zeros.
const formatDecimalString = (value: number, decimals: number): string => {
  if (!Number.isFinite(value)) {
    throw new FiatToAmountError(`Non-finite amount computed: ${value}`)
  }
  const str = /[eE]/.test(value.toString()) ? value.toFixed(decimals) : value.toString()
  if (!str.includes('.')) return str
  const [whole, fraction] = str.split('.')
  const trimmed = fraction.slice(0, decimals).replace(/0+$/, '')
  return trimmed === '' ? whole : `${whole}.${trimmed}`
}

/**
 * Convert a fiat value (e.g. USD) to a token amount using the current market price.
 *
 * Uses the SDK's existing price helpers:
 * - `getCoinPrices` for native tokens
 * - `getErc20Prices` for ERC-20 tokens (EVM chains only)
 *
 * Returns a human-readable decimal string (e.g. "0.05"). Callers decide whether
 * to convert to base units via `parseUnits` / `toChainAmount`.
 *
 * @throws {FiatToAmountError} On invalid input, missing price data, or network failure.
 *
 * @example
 * ```typescript
 * // $100 of ETH at current market price
 * const ethAmount = await fiatToAmount({
 *   fiatValue: 100,
 *   chain: Chain.Ethereum,
 *   decimals: 18,
 * })
 *
 * // $50 of USDC on Ethereum
 * const usdcAmount = await fiatToAmount({
 *   fiatValue: 50,
 *   chain: Chain.Ethereum,
 *   tokenId: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
 *   decimals: 6,
 * })
 * ```
 */
export const fiatToAmount = async (params: FiatToAmountParams): Promise<string> => {
  const { fiatValue, chain, tokenId, decimals, fiatCurrency = 'usd' } = params

  const value = parseFiatValue(fiatValue)
  const currency = String(fiatCurrency).toLowerCase()
  if (!fiatCurrencySet.has(currency)) {
    throw new FiatToAmountError(`Unsupported fiat currency "${fiatCurrency}". Known: [${fiatCurrencies.join(', ')}].`)
  }
  const normalizedCurrency = currency as FiatCurrency

  let price: number
  try {
    if (tokenId) {
      if (!isChainOfKind(chain, 'evm')) {
        throw new FiatToAmountError(
          `Token price lookup by contract address is only supported on EVM chains. Got chain "${chain}" with tokenId "${tokenId}".`
        )
      }
      const prices = await getErc20Prices({
        ids: [tokenId],
        chain,
        fiatCurrency: normalizedCurrency,
      })
      price = prices[tokenId.toLowerCase()] ?? 0
    } else {
      const feeCoin = chainFeeCoin[chain]
      if (!feeCoin?.priceProviderId) {
        throw new FiatToAmountError(`No price provider ID configured for chain "${chain}".`)
      }
      const prices = await getCoinPrices({
        ids: [feeCoin.priceProviderId],
        fiatCurrency: normalizedCurrency,
      })
      price = prices[feeCoin.priceProviderId] ?? 0
    }
  } catch (error) {
    if (error instanceof FiatToAmountError) throw error
    throw new FiatToAmountError(
      `Failed to fetch price for ${tokenId ? `token ${tokenId}` : 'native token'} on ${chain}: ${(error as Error).message}`
    )
  }

  if (!Number.isFinite(price) || price <= 0) {
    throw new FiatToAmountError(
      `Price lookup returned no usable price for ${tokenId ? `token ${tokenId}` : 'native token'} on ${chain} (currency: ${normalizedCurrency}).`
    )
  }

  const amount = value / price
  return formatDecimalString(amount, decimals)
}
