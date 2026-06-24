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

// proto3 fixed-width integer domains. uint64 fields (poolId, lockId,
// positionId, position_ids) MUST fit in 0..2^64-1, and int64 ticks in
// -2^63..2^63-1 — otherwise the wire encoder truncates modulo 2^64 and silently
// signs a DIFFERENT value than the user asked for. We bound here (and again at
// the encode choke point in proto.ts) so the rejection is loud + early.
const U64_MAX = (1n << 64n) - 1n
const I64_MIN = -(1n << 63n)
const I64_MAX = (1n << 63n) - 1n

/**
 * Validate a positive `uint64` id string (poolId / lockId / positionId): a
 * positive integer that fits the proto3 uint64 domain (1..2^64-1). Rejects
 * values above 2^64-1 that the wire encoder would otherwise wrap to a different,
 * attacker-chosen id.
 */
export function validateUint64Id(value: string, field: string): string {
  const trimmed = validatePositiveInt(value, field)
  if (BigInt(trimmed) > U64_MAX) {
    throw new Error(`invalid ${field}: exceeds uint64 max (2^64-1); got "${trimmed}"`)
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

/**
 * Validate a signed `int64` integer (ticks can be negative, e.g. -887200), and
 * bound it to the proto3 int64 domain so an out-of-range tick can't wrap on the
 * wire to a different value than the user supplied.
 */
export function validateSignedInt(value: string, field: string): string {
  const trimmed = (value ?? '').trim()
  if (!/^-?[0-9]+$/.test(trimmed)) {
    throw new Error(`invalid ${field}: must be a signed integer string (got "${trimmed}")`)
  }
  const v = BigInt(trimmed)
  if (v < I64_MIN || v > I64_MAX) {
    throw new Error(`invalid ${field}: out of int64 range (-2^63..2^63-1); got "${trimmed}"`)
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
  // Deterministic on-chain ordering. Cosmos-SDK `Coins.Validate()` requires
  // denoms sorted by BYTE order (not locale collation) and rejects an unsorted
  // set in ValidateBasic. `localeCompare` diverges from byte order across the
  // upper/lower-case boundary (e.g. "ibc/Z…" vs a lowercase denom), which could
  // emit an unsorted Coins that fails at broadcast — so sort by raw code unit.
  return [...coins].sort((a, b) => (a.denom < b.denom ? -1 : a.denom > b.denom ? 1 : 0))
}
