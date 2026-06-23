/**
 * Pure cosmos-sdk staking + distribution msg-envelope builders.
 *
 * `sdk.prep.cosmosStaking.{delegate,undelegate,redelegate,withdraw}`
 *
 * These are PURE CRYPTO primitives: given a staking intent (validated
 * delegator/validator addresses + a base-unit amount), they emit the
 * unsigned, proto-`Any`-encoded msg envelope for the x/staking and
 * x/distribution modules. They do NOT touch the network, do NOT sign, and
 * do NOT broadcast — the returned envelope is fed into
 * `prepareSignDirectTxFromKeys` (proto direct-sign) or the app's
 * `buildSignBroadcastCosmosStaking` to produce a SignDoc.
 *
 * Ported from mcp-ts `src/tools/staking/cosmos-staking.ts`
 * (build_cosmos_delegate / undelegate / redelegate / withdraw_rewards),
 * which previously returned a parsed-kind envelope that the app re-derived
 * into proto bytes. This consolidates the proto-`Any` encoding (the actual
 * crypto) into the SDK so every consumer (mcp-ts, agent-backend, the app)
 * builds the SAME wire bytes from one code path.
 *
 * Proto wire shapes (cosmos-sdk v0.46+):
 *   cosmos.staking.v1beta1.MsgDelegate
 *     string delegator_address = 1;
 *     string validator_address = 2;
 *     cosmos.base.v1beta1.Coin amount = 3;   { string denom = 1; string amount = 2; }
 *   cosmos.staking.v1beta1.MsgUndelegate     (identical wire layout to MsgDelegate)
 *   cosmos.staking.v1beta1.MsgBeginRedelegate
 *     string delegator_address     = 1;
 *     string validator_src_address = 2;
 *     string validator_dst_address = 3;
 *     cosmos.base.v1beta1.Coin amount = 4;
 *   cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward
 *     string delegator_address = 1;
 *     string validator_address = 2;
 */
import { bech32 } from 'bech32'
import { Buffer } from 'buffer'

import { CosmosMsgType } from '../../types/cosmos-msg'

// ---------------------------------------------------------------------------
// Minimal protobuf encoder (length-delimited varint, wire types 0/2 only).
// Self-contained so this stays a zero-runtime-dep pure module. Mirrors the
// encoder in src/platforms/react-native/chains/cosmos/tx.ts byte-for-byte.
// ---------------------------------------------------------------------------

function varint(n: number): Uint8Array {
  // `>>>=` operates on 32-bit unsigned ints; anything above 2^32-1 silently
  // wraps and would emit a varint that decodes to a different number. Every
  // call here is a field tag (<= 2^7) or a length prefix (<= Uint8Array.length),
  // but we guard the boundary so a future caller can't silently corrupt the body.
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new Error(`varint: value out of range (got ${n})`)
  }
  const bytes: number[] = []
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80)
    n >>>= 7
  }
  bytes.push(n & 0x7f)
  return new Uint8Array(bytes)
}

function field(fieldNum: number, wireType: number, data: Uint8Array): Uint8Array {
  const tag = varint((fieldNum << 3) | wireType)
  if (wireType === 2) {
    const len = varint(data.length)
    const result = new Uint8Array(tag.length + len.length + data.length)
    result.set(tag, 0)
    result.set(len, tag.length)
    result.set(data, tag.length + len.length)
    return result
  }
  const result = new Uint8Array(tag.length + data.length)
  result.set(tag, 0)
  result.set(data, tag.length)
  return result
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    result.set(a, offset)
    offset += a.length
  }
  return result
}

function encodeString(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

/** cosmos.base.v1beta1.Coin { string denom = 1; string amount = 2; } */
function encodeCoin(denom: string, amount: string): Uint8Array {
  return concat(field(1, 2, encodeString(denom)), field(2, 2, encodeString(amount)))
}

// ---------------------------------------------------------------------------
// Input validation (pure, no network). Ported from mcp-ts cosmos-staking.ts.
// ---------------------------------------------------------------------------

const POSITIVE_INT_RE = /^[0-9]+$/

/**
 * Assert a strictly-positive integer base-unit amount string (e.g. "5000000"
 * for 5 OSMO at 6 decimals). Mirrors mcp-ts `validateBaseUnitAmount`.
 */
function validateBaseUnitAmount(value: string, fieldName = 'amount'): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) {
    throw new Error(`invalid ${fieldName}: must be a non-empty string`)
  }
  if (!POSITIVE_INT_RE.test(trimmed) || BigInt(trimmed) <= 0n) {
    throw new Error(`invalid ${fieldName}: must be a positive integer base-unit string (got "${trimmed}")`)
  }
  return trimmed
}

/** Non-empty denom (e.g. "uosmo", "uatom", "uluna"). */
function validateDenom(value: string, fieldName = 'denom'): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) {
    throw new Error(`invalid ${fieldName}: must be a non-empty string`)
  }
  return trimmed
}

/**
 * The address ROLE a field expects, derived from the cosmos-sdk bech32 HRP
 * suffix convention (`...valoper` = operator, `...valcons` = consensus, else
 * account). Lets us enforce a deterministic role guard even when the caller
 * does NOT pass an explicit `expectedPrefix` — the optional-prefix happy path.
 */
type AddressRole = 'account' | 'validator'

/**
 * Classify a decoded bech32 HRP. Mirrors mcp-ts `validatorRoleForHrp`
 * (src/lib/cosmos-address-guard.ts). An HRP ending in `valoper`/`valcons` is a
 * validator key, NOT a spendable account.
 */
function hrpIsValidatorRole(hrp: string): boolean {
  const lower = hrp.toLowerCase()
  return lower.endsWith('valoper') || lower.endsWith('valcons')
}

/**
 * Validate a bech32 cosmos address with an optional expected human-readable
 * prefix (hrp). Rejects malformed bech32 and prefix mismatches, and checks the
 * decoded payload is a 20- or 32-byte account/operator key (rejects IBC channel
 * ids and other non-account word-lengths). Ported from mcp-ts `validateBech32`
 * + `assertNotValidatorHrp` (src/lib/cosmos-address-guard.ts).
 *
 * FUND-SAFETY ROLE GUARD (always on, prefix-independent): cosmos-sdk derives
 * account / validator-operator / validator-consensus addresses from the SAME
 * chain HRP by appending a `valoper`/`valcons` role suffix. mcp-ts
 * `build_cosmos_*` ALWAYS calls `validateBech32` with a concrete account/valoper
 * prefix AND runs `assertNotValidatorHrp` on every account-role field, so a
 * `...valoper1...`/`...valcons1...` handed in where the delegator belongs is
 * rejected before any bytes are emitted. This SDK port made `expectedPrefix`
 * optional (the documented "hrp validated upstream" happy path) — without a
 * role guard, a valoper/valcons string passed as `delegatorAddress` would sail
 * straight into a signing-ready `MsgDelegate`. The chain treats the delegator
 * as the fee/signer account, so a valoper-as-delegator either signs against a
 * key the user doesn't control or builds a tx the signer can't authorize. We
 * re-add the guard HRP-suffix-wise so it holds on every chain with or without
 * an explicit prefix, byte-for-byte matching mcp-ts's fund-safety contract.
 *
 * @param expectedPrefix when provided (e.g. "osmo" / "osmovaloper"), the address
 *   hrp must match exactly. Omit to accept any valid cosmos bech32 hrp.
 * @param expectedRole the role this field MUST be. `'account'` rejects any
 *   `valoper`/`valcons` HRP (delegator fields); `'validator'` rejects a plain
 *   account HRP handed in where an operator address is required.
 */
function validateBech32(value: string, fieldName: string, expectedPrefix?: string, expectedRole?: AddressRole): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) {
    throw new Error(`invalid ${fieldName}: must be a non-empty string`)
  }
  let decoded: { prefix: string; words: number[] }
  try {
    decoded = bech32.decode(trimmed)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`invalid ${fieldName}: malformed bech32 (${msg})`, { cause: error })
  }
  // Role guard runs BEFORE the optional exact-prefix check so the explicit,
  // fund-safety-flavored message wins over a generic prefix mismatch.
  if (expectedRole !== undefined) {
    const isValidator = hrpIsValidatorRole(decoded.prefix)
    if (expectedRole === 'account' && isValidator) {
      throw new Error(
        `invalid ${fieldName}: "${decoded.prefix}1..." is a validator key, not a spendable account. ` +
          `The delegator/account field must be a plain account address ` +
          `("${decoded.prefix.toLowerCase().replace(/(valoper|valcons)$/, '')}1..."); ` +
          `the validator goes in the validator address field. Funds/fees on a validator key are not recoverable.`
      )
    }
    if (expectedRole === 'validator' && !isValidator) {
      throw new Error(
        `invalid ${fieldName}: "${decoded.prefix}1..." is a plain account address, not a validator operator address ` +
          `(expected a "...valoper1..." key).`
      )
    }
  }
  if (typeof expectedPrefix === 'string' && decoded.prefix !== expectedPrefix) {
    throw new Error(`invalid ${fieldName}: expected ${expectedPrefix} prefix, got ${decoded.prefix}`)
  }
  let payload: number[]
  try {
    payload = bech32.fromWords(decoded.words)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`invalid ${fieldName}: malformed bech32 data (${msg})`, { cause: error })
  }
  if (payload.length !== 20 && payload.length !== 32) {
    throw new Error(`invalid ${fieldName}: expected 20- or 32-byte payload, got ${payload.length}`)
  }
  return trimmed
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * An unsigned cosmos msg envelope: the proto `Any` typeUrl plus the
 * length-delimited protobuf-encoded msg value (base64). This is exactly the
 * `{ typeUrl, value }` pair that goes into a `TxBody.messages[]` Any before
 * signing. Pure crypto — never signed or broadcast by this module.
 */
export type CosmosStakingMsgEnvelope = {
  /** proto `Any` typeUrl, e.g. `/cosmos.staking.v1beta1.MsgDelegate`. */
  typeUrl: string
  /** base64 of the length-delimited protobuf-encoded msg value. */
  valueBase64: string
}

export type DelegateParams = {
  /** Account address staking the funds (e.g. `osmo1...`). */
  delegatorAddress: string
  /** Validator operator address (e.g. `osmovaloper1...`). */
  validatorAddress: string
  /** Amount in base units as a positive integer string (e.g. "5000000"). */
  amount: string
  /** Staking denom (e.g. "uosmo"). */
  denom: string
  /**
   * Optional bech32 hrp guards. When provided, the addresses must match.
   * Omit when the caller has already validated hrps upstream.
   */
  accountPrefix?: string
  validatorPrefix?: string
}

export type UndelegateParams = DelegateParams

export type RedelegateParams = {
  delegatorAddress: string
  /** Source validator the delegation is moved FROM. */
  validatorSrcAddress: string
  /** Destination validator the delegation is moved TO. */
  validatorDstAddress: string
  amount: string
  denom: string
  accountPrefix?: string
  validatorPrefix?: string
}

export type WithdrawRewardsParams = {
  delegatorAddress: string
  /** Validator(s) to claim accrued rewards from. One Any msg per validator. */
  validatorAddress: string
  accountPrefix?: string
  validatorPrefix?: string
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function toEnvelope(typeUrl: string, value: Uint8Array): CosmosStakingMsgEnvelope {
  return { typeUrl, valueBase64: Buffer.from(value).toString('base64') }
}

/**
 * Build an unsigned `cosmos.staking.v1beta1.MsgDelegate` envelope.
 *
 * Stakes `amount` base units of `denom` from `delegatorAddress` to
 * `validatorAddress`. Pure crypto: returns the proto-`Any` typeUrl + value;
 * does not sign or broadcast.
 */
export function buildDelegateMsg(params: DelegateParams): CosmosStakingMsgEnvelope {
  const delegator = validateBech32(params.delegatorAddress, 'delegatorAddress', params.accountPrefix, 'account')
  const validator = validateBech32(params.validatorAddress, 'validatorAddress', params.validatorPrefix, 'validator')
  const amount = validateBaseUnitAmount(params.amount, 'amount')
  const denom = validateDenom(params.denom, 'denom')
  const value = concat(
    field(1, 2, encodeString(delegator)),
    field(2, 2, encodeString(validator)),
    field(3, 2, encodeCoin(denom, amount))
  )
  return toEnvelope(CosmosMsgType.MsgDelegateUrl, value)
}

/**
 * Build an unsigned `cosmos.staking.v1beta1.MsgUndelegate` envelope.
 * Identical wire layout to MsgDelegate; only the typeUrl differs.
 */
export function buildUndelegateMsg(params: UndelegateParams): CosmosStakingMsgEnvelope {
  const delegator = validateBech32(params.delegatorAddress, 'delegatorAddress', params.accountPrefix, 'account')
  const validator = validateBech32(params.validatorAddress, 'validatorAddress', params.validatorPrefix, 'validator')
  const amount = validateBaseUnitAmount(params.amount, 'amount')
  const denom = validateDenom(params.denom, 'denom')
  const value = concat(
    field(1, 2, encodeString(delegator)),
    field(2, 2, encodeString(validator)),
    field(3, 2, encodeCoin(denom, amount))
  )
  return toEnvelope(CosmosMsgType.MsgUndelegateUrl, value)
}

/**
 * Build an unsigned `cosmos.staking.v1beta1.MsgBeginRedelegate` envelope.
 * Moves `amount` instantly from src validator to dst validator (no unbonding).
 */
export function buildRedelegateMsg(params: RedelegateParams): CosmosStakingMsgEnvelope {
  const delegator = validateBech32(params.delegatorAddress, 'delegatorAddress', params.accountPrefix, 'account')
  const src = validateBech32(params.validatorSrcAddress, 'validatorSrcAddress', params.validatorPrefix, 'validator')
  const dst = validateBech32(params.validatorDstAddress, 'validatorDstAddress', params.validatorPrefix, 'validator')
  if (src === dst) {
    throw new Error('invalid redelegate: validatorSrcAddress and validatorDstAddress must differ')
  }
  const amount = validateBaseUnitAmount(params.amount, 'amount')
  const denom = validateDenom(params.denom, 'denom')
  const value = concat(
    field(1, 2, encodeString(delegator)),
    field(2, 2, encodeString(src)),
    field(3, 2, encodeString(dst)),
    field(4, 2, encodeCoin(denom, amount))
  )
  return toEnvelope(CosmosMsgType.MsgBeginRedelegateUrl, value)
}

/**
 * Build an unsigned `cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward`
 * envelope for a single validator. To claim from many validators in one tx,
 * call once per validator and bundle the envelopes into one `TxBody.messages[]`.
 */
export function buildWithdrawRewardsMsg(params: WithdrawRewardsParams): CosmosStakingMsgEnvelope {
  const delegator = validateBech32(params.delegatorAddress, 'delegatorAddress', params.accountPrefix, 'account')
  const validator = validateBech32(params.validatorAddress, 'validatorAddress', params.validatorPrefix, 'validator')
  const value = concat(field(1, 2, encodeString(delegator)), field(2, 2, encodeString(validator)))
  return toEnvelope(CosmosMsgType.MsgWithdrawDelegatorRewardUrl, value)
}

/**
 * Namespaced surface: `sdk.prep.cosmosStaking.{delegate,undelegate,redelegate,withdraw}`.
 *
 * Every method returns an unsigned proto-`Any` msg envelope. Quotes/builds-unsigned
 * only — NEVER signs or broadcasts.
 */
export const cosmosStaking = {
  delegate: buildDelegateMsg,
  undelegate: buildUndelegateMsg,
  redelegate: buildRedelegateMsg,
  withdraw: buildWithdrawRewardsMsg,
} as const
