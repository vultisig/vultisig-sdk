/**
 * Input validation for the Osmosis DeFi builders.
 *
 * Fund-safety driven: every address is bech32-checked with an explicit
 * account-vs-validator guard so an `osmovaloper1...` operator key can never be
 * silently used where a spendable `osmo1...` account is expected (and vice
 * versa). Amounts are kept as base-unit integer strings — sdk.Int on-chain is a
 * big integer; a stray decimal would fail at broadcast.
 *
 * Ported from mcp-ts `osmosis-{gamm,cl,superfluid}.ts` validation, distilled to
 * a shared module so all three surfaces share one bech32/guard implementation.
 */
import { bech32 } from 'bech32'

export const OSMOSIS_CHAIN_ID = 'osmosis-1'
export const OSMOSIS_BECH32_PREFIX = 'osmo'
export const OSMOSIS_VALIDATOR_BECH32_PREFIX = 'osmovaloper'

/**
 * Known Cosmos validator-operator HRP suffixes. If an account-side field
 * receives one of these, that's almost certainly a user pasting a validator
 * address where a spendable account belongs — reject loudly.
 */
const VALIDATOR_HRP_SUFFIX = 'valoper'

function assertNotValidatorHrp(prefix: string, field: string): void {
  if (prefix.endsWith(VALIDATOR_HRP_SUFFIX)) {
    throw new Error(
      `invalid ${field}: got a validator operator address ("${prefix}1..."), expected a spendable account address`
    )
  }
}

/**
 * Decode + validate a bech32 address against an expected prefix.
 *
 * When `expectedPrefix` is an account prefix (not ending in "valoper"), a
 * validator address is rejected before the generic prefix-mismatch error so the
 * caller gets the precise fund-safety reason.
 */
export function validateBech32(value: string, field: string, expectedPrefix: string): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) throw new Error(`invalid ${field}: must be a non-empty string`)

  let decoded: { prefix: string; words: number[] }
  try {
    decoded = bech32.decode(trimmed)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`invalid ${field}: malformed bech32 (${msg})`)
  }

  const expectsAccount = !expectedPrefix.endsWith(VALIDATOR_HRP_SUFFIX)
  if (expectsAccount) {
    assertNotValidatorHrp(decoded.prefix, field)
  }
  if (decoded.prefix !== expectedPrefix) {
    throw new Error(`invalid ${field}: expected "${expectedPrefix}" prefix, got "${decoded.prefix}"`)
  }
  const payload = bech32.fromWords(decoded.words)
  if (payload.length !== 20 && payload.length !== 32) {
    throw new Error(`invalid ${field}: expected 20- or 32-byte payload, got ${payload.length}`)
  }
  return trimmed
}

/** Validate an `osmo1...` spendable account address. */
export function validateOsmoAddress(value: string, field: string): string {
  return validateBech32(value, field, OSMOSIS_BECH32_PREFIX)
}

/** Validate an `osmovaloper1...` validator-operator address. */
export function validateOsmoValidator(value: string, field: string): string {
  return validateBech32(value, field, OSMOSIS_VALIDATOR_BECH32_PREFIX)
}

/** Validate a positive integer base-unit string (no decimals, > 0). */
export function validatePositiveInt(value: string, field: string): string {
  const trimmed = (value ?? '').trim()
  if (!/^[0-9]+$/.test(trimmed) || BigInt(trimmed) <= 0n) {
    throw new Error(`invalid ${field}: must be a positive integer string (got "${trimmed}")`)
  }
  return trimmed
}

/** Validate a non-negative integer base-unit string (>= 0, e.g. a slippage min of "0"). */
export function validateNonNegativeInt(value: string, field: string): string {
  const trimmed = (value ?? '').trim()
  if (!/^[0-9]+$/.test(trimmed) || BigInt(trimmed) < 0n) {
    throw new Error(`invalid ${field}: must be a non-negative integer string (got "${trimmed}")`)
  }
  return trimmed
}

/** Validate a signed integer (ticks can be negative, e.g. -887200). */
export function validateSignedInt(value: string, field: string): string {
  const trimmed = (value ?? '').trim()
  if (!/^-?[0-9]+$/.test(trimmed)) {
    throw new Error(`invalid ${field}: must be a signed integer string (got "${trimmed}")`)
  }
  return trimmed
}

/**
 * Validate a CL liquidity amount. Withdraw takes a *decimal* liquidity string
 * (osmosis stores liquidity as a Dec), unlike the integer base-unit amounts.
 */
export function validatePositiveDecimal(value: string, field: string): string {
  const trimmed = (value ?? '').trim()
  if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed) || Number(trimmed) <= 0) {
    throw new Error(`invalid ${field}: must be a positive decimal string (got "${trimmed}")`)
  }
  return trimmed
}

/** Validate + normalize a non-empty array of `{denom, amount}` base-unit coins. */
export function validateCoins(
  value: unknown,
  field: string,
  { allowZero = false }: { allowZero?: boolean } = {}
): { denom: string; amount: string }[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must be a non-empty array of {denom, amount}`)
  }
  const coins = value.map((c, i) => {
    const entry = c as { denom?: unknown; amount?: unknown }
    if (!entry.denom || typeof entry.denom !== 'string') {
      throw new Error(`${field}[${i}]: each coin must have a denom string`)
    }
    const amount = String(entry.amount ?? '').trim()
    if (allowZero) {
      validateNonNegativeInt(amount, `${field}[${i}].amount`)
    } else {
      validatePositiveInt(amount, `${field}[${i}].amount`)
    }
    return { denom: entry.denom, amount }
  })
  // Deterministic on-chain ordering: Osmosis sorts coins by denom.
  return [...coins].sort((a, b) => a.denom.localeCompare(b.denom))
}
