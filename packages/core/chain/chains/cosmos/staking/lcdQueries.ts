/**
 * LCD query helpers for the cosmos-sdk staking + distribution modules.
 *
 * Read-only HTTP fetches against the per-chain `cosmosRpcUrl` (which actually
 * points at the LCD/REST endpoint, despite the dict name). All endpoints are
 * unauthenticated, public, and rate-limited at most by the upstream provider.
 *
 * Generic across every cosmos-sdk chain we support — same paths, just
 * different LCD root. No chain-specific branching.
 */
import { Chain, IbcEnabledCosmosChain } from '@vultisig/core-chain/Chain'

import { cosmosRpcUrl } from '../cosmosRpcUrl'
import { qbtcRestUrl } from '../qbtc/tendermintRpcUrl'

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type Coin = { denom: string; amount: string }

export type Delegation = {
  /** valoper bech32, e.g. `cosmosvaloper1...` */
  validatorAddress: string
  /** Current liquid balance currently delegated to this validator */
  balance: Coin
  /** Raw shares (NOT 1:1 with balance after slashing). String to preserve precision. */
  shares: string
}

export type UnbondingEntry = {
  /** Block height at which the unbonding was initiated */
  creationHeight: string
  /** ISO-8601 string when this entry completes (becomes spendable) */
  completionTime: string
  /** Amount in stake denom base units that will be returned */
  initialBalance: string
  /** Amount remaining after any slashing during the unbonding window */
  balance: string
}

export type UnbondingDelegation = {
  validatorAddress: string
  entries: UnbondingEntry[]
}

export type DelegatorReward = {
  validatorAddress: string
  /** Per-denom reward (some chains have multi-asset rewards) */
  reward: Coin[]
}

export type DelegatorRewardsResponse = {
  rewards: DelegatorReward[]
  total: Coin[]
}

/**
 * Validator bond status as reported by the staking module.
 * `BOND_STATUS_BONDED` validators are in the active set and earn rewards.
 * `UNBONDING` / `UNBONDED` are out of the active set; `UNSPECIFIED` is the
 * default-uninitialized value (only seen on misbehaving chains, treat as
 * unknown).
 */
export type ValidatorStatus =
  | 'BOND_STATUS_UNSPECIFIED'
  | 'BOND_STATUS_UNBONDED'
  | 'BOND_STATUS_UNBONDING'
  | 'BOND_STATUS_BONDED'

export type ValidatorDescription = {
  moniker: string
  /** Keybase identity hex (16 chars) for avatar lookup; "" if unset */
  identity: string
  website: string
  securityContact: string
  details: string
}

export type ValidatorCommission = {
  /** Current commission rate as 18-decimal Dec string, e.g. "0.050000000000000000" for 5% */
  rate: string
  maxRate: string
  maxChangeRate: string
}

export type Validator = {
  /** valoper bech32, e.g. `terravaloper1...` */
  operatorAddress: string
  jailed: boolean
  status: ValidatorStatus
  /** Total bonded tokens in base units. String to preserve precision. */
  tokens: string
  /** Raw shares issued. String to preserve precision. */
  delegatorShares: string
  description: ValidatorDescription
  commission: ValidatorCommission
  minSelfDelegation: string
}

/**
 * Discriminated by `@type` on the auth/accounts response. We only surface
 * vesting variants the staking module cares about; non-vesting addresses
 * return `null` from `getCosmosVestingAccount`.
 */
export type PeriodicVestingAccount = {
  '@type': '/cosmos.vesting.v1beta1.PeriodicVestingAccount'
  base_vesting_account: {
    base_account: {
      address: string
      account_number: string
      sequence: string
      pub_key?: { '@type': string; key: string } | null
    }
    original_vesting: Coin[]
    delegated_free: Coin[]
    delegated_vesting: Coin[]
    end_time: string
  }
  start_time: string
  vesting_periods: Array<{ length: string; amount: Coin[] }>
}

export type ContinuousVestingAccount = {
  '@type': '/cosmos.vesting.v1beta1.ContinuousVestingAccount'
  base_vesting_account: PeriodicVestingAccount['base_vesting_account']
  start_time: string
}

export type DelayedVestingAccount = {
  '@type': '/cosmos.vesting.v1beta1.DelayedVestingAccount'
  base_vesting_account: PeriodicVestingAccount['base_vesting_account']
}

export type VestingAccount = PeriodicVestingAccount | ContinuousVestingAccount | DelayedVestingAccount

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

/**
 * `cosmosRpcUrl` covers all CosmosChain entries (incl THORChain/MayaChain
 * vault-based variants) but the cosmos-sdk staking module endpoints only
 * make sense on `IbcEnabledCosmosChain`. Tighten the type at the boundary
 * so callers can't accidentally hit `/cosmos/staking/...` against a
 * THORChain LCD that doesn't serve it.
 *
 * QBTC is a Cosmos-SDK chain too (post-quantum testnet, MLDSA-signed) and
 * serves the same x/staking + x/distribution endpoints, but it lives in
 * `OtherChain` rather than `CosmosChain` (WalletCore can't sign it), so it
 * isn't a key of `cosmosRpcUrl`. Include it explicitly and resolve its LCD
 * root via `qbtcRestUrl`.
 */
export type StakingChain = IbcEnabledCosmosChain | typeof Chain.QBTC

/**
 * LCD/REST root for a staking chain. QBTC isn't keyed in `cosmosRpcUrl`, so
 * route it to its dedicated REST endpoint; every other staking chain is a
 * `CosmosChain` and indexes `cosmosRpcUrl` directly.
 */
const stakingLcdRoot = (chain: StakingChain): string =>
  chain === Chain.QBTC ? qbtcRestUrl : cosmosRpcUrl[chain]

export const getDelegationsUrl = (chain: StakingChain, delegatorAddress: string): string =>
  `${stakingLcdRoot(chain)}/cosmos/staking/v1beta1/delegations/${delegatorAddress}`

export const getUnbondingDelegationsUrl = (chain: StakingChain, delegatorAddress: string): string =>
  `${stakingLcdRoot(chain)}/cosmos/staking/v1beta1/delegators/${delegatorAddress}/unbonding_delegations`

export const getDelegatorRewardsUrl = (chain: StakingChain, delegatorAddress: string): string =>
  `${stakingLcdRoot(chain)}/cosmos/distribution/v1beta1/delegators/${delegatorAddress}/rewards`

export const getAuthAccountUrl = (chain: StakingChain, address: string): string =>
  `${stakingLcdRoot(chain)}/cosmos/auth/v1beta1/accounts/${address}`

/**
 * Validator list endpoint. Optional `status` filter is the canonical way to
 * exclude jailed / unbonding validators from the picker — without it, large
 * chains like TerraClassic return hundreds of inactive entries. `paginationKey`
 * is the opaque cursor returned by the previous page.
 */
export const getValidatorsUrl = (
  chain: StakingChain,
  opts: { status?: ValidatorStatus; limit?: number; paginationKey?: string } = {}
): string => {
  const params = new URLSearchParams()
  if (opts.status) params.set('status', opts.status)
  if (opts.limit !== undefined) params.set('pagination.limit', String(opts.limit))
  if (opts.paginationKey) params.set('pagination.key', opts.paginationKey)
  const qs = params.toString()
  return `${stakingLcdRoot(chain)}/cosmos/staking/v1beta1/validators${qs ? `?${qs}` : ''}`
}

export const getValidatorUrl = (chain: StakingChain, validatorAddress: string): string =>
  `${stakingLcdRoot(chain)}/cosmos/staking/v1beta1/validators/${validatorAddress}`

// ---------------------------------------------------------------------------
// Fetchers (raw fetch, no Stargate dep — works in RN + Node + browser)
// ---------------------------------------------------------------------------

type FetchOpts = { fetchImpl?: typeof fetch; signal?: AbortSignal }

async function lcdGet<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const f = opts.fetchImpl ?? fetch
  const res = await f(url, { signal: opts.signal })
  if (!res.ok) {
    // 404 on `/auth/accounts/{addr}` for an unseen address is a legitimate
    // response shape on some chains. Caller decides what to do with it; we
    // surface the status so they can branch on `error.message.includes('404')`.
    throw new Error(`LCD ${res.status}: ${url}`)
  }
  return (await res.json()) as T
}

export async function getCosmosDelegations(
  chain: StakingChain,
  delegatorAddress: string,
  opts: FetchOpts = {}
): Promise<Delegation[]> {
  type Raw = {
    delegation_responses: Array<{
      delegation: { delegator_address: string; validator_address: string; shares: string }
      balance: Coin
    }>
  }
  const raw = await lcdGet<Raw>(getDelegationsUrl(chain, delegatorAddress), opts)
  return raw.delegation_responses.map(d => ({
    validatorAddress: d.delegation.validator_address,
    balance: d.balance,
    shares: d.delegation.shares,
  }))
}

export async function getCosmosUnbondingDelegations(
  chain: StakingChain,
  delegatorAddress: string,
  opts: FetchOpts = {}
): Promise<UnbondingDelegation[]> {
  type Raw = {
    unbonding_responses: Array<{
      delegator_address: string
      validator_address: string
      entries: Array<{
        creation_height: string
        completion_time: string
        initial_balance: string
        balance: string
      }>
    }>
  }
  const raw = await lcdGet<Raw>(getUnbondingDelegationsUrl(chain, delegatorAddress), opts)
  return raw.unbonding_responses.map(u => ({
    validatorAddress: u.validator_address,
    entries: u.entries.map(e => ({
      creationHeight: e.creation_height,
      completionTime: e.completion_time,
      initialBalance: e.initial_balance,
      balance: e.balance,
    })),
  }))
}

export async function getCosmosDelegatorRewards(
  chain: StakingChain,
  delegatorAddress: string,
  opts: FetchOpts = {}
): Promise<DelegatorRewardsResponse> {
  type Raw = {
    rewards: Array<{ validator_address: string; reward: Coin[] }>
    total: Coin[]
  }
  const raw = await lcdGet<Raw>(getDelegatorRewardsUrl(chain, delegatorAddress), opts)
  return {
    // `?? []` on both fields: an address with zero unclaimed rewards (rare
    // but valid - e.g. brand-new delegator who hasn't accrued anything yet,
    // or one who claimed in the same block) returns a body where `rewards`
    // (and sometimes `total`) is missing entirely on some chain firmwares.
    // Without the fallback the .map call would throw on undefined.
    rewards: (raw.rewards ?? []).map(r => ({ validatorAddress: r.validator_address, reward: r.reward })),
    total: raw.total ?? [],
  }
}

type RawValidator = {
  operator_address: string
  jailed?: boolean
  status: ValidatorStatus
  tokens: string
  delegator_shares: string
  description: {
    moniker?: string
    identity?: string
    website?: string
    security_contact?: string
    details?: string
  }
  commission: {
    commission_rates: {
      rate: string
      max_rate: string
      max_change_rate: string
    }
  }
  min_self_delegation: string
}

const parseValidator = (v: RawValidator): Validator => ({
  operatorAddress: v.operator_address,
  jailed: v.jailed ?? false,
  status: v.status,
  tokens: v.tokens,
  delegatorShares: v.delegator_shares,
  description: {
    moniker: v.description.moniker ?? '',
    identity: v.description.identity ?? '',
    website: v.description.website ?? '',
    securityContact: v.description.security_contact ?? '',
    details: v.description.details ?? '',
  },
  commission: {
    rate: v.commission.commission_rates.rate,
    maxRate: v.commission.commission_rates.max_rate,
    maxChangeRate: v.commission.commission_rates.max_change_rate,
  },
  minSelfDelegation: v.min_self_delegation,
})

/**
 * Returns the full validator set for the chain, auto-paginating until the
 * LCD reports `next_key === null`. Pass `status: 'BOND_STATUS_BONDED'` to
 * limit to the active set (the typical case for stake-picker UIs).
 *
 * `pageLimit` (default 200) caps per-request size; the LCD caps it at 200 on
 * most chains. Total pages walked is bounded to avoid runaway pagination on
 * a misbehaving endpoint.
 */
export async function getCosmosValidators(
  chain: StakingChain,
  opts: FetchOpts & { status?: ValidatorStatus; pageLimit?: number } = {}
): Promise<Validator[]> {
  type Raw = {
    validators: RawValidator[]
    pagination: { next_key: string | null; total?: string }
  }
  const pageLimit = opts.pageLimit ?? 200
  const collected: Validator[] = []
  let paginationKey: string | undefined
  const MAX_PAGES = 50
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = getValidatorsUrl(chain, {
      status: opts.status,
      limit: pageLimit,
      paginationKey,
    })
    const raw = await lcdGet<Raw>(url, opts)
    for (const v of raw.validators) collected.push(parseValidator(v))
    if (!raw.pagination.next_key) return collected
    paginationKey = raw.pagination.next_key
  }
  throw new Error(`getCosmosValidators: exceeded ${MAX_PAGES} pages on ${chain} (possible LCD pagination bug)`)
}

export async function getCosmosValidator(
  chain: StakingChain,
  validatorAddress: string,
  opts: FetchOpts = {}
): Promise<Validator> {
  type Raw = { validator: RawValidator }
  const raw = await lcdGet<Raw>(getValidatorUrl(chain, validatorAddress), opts)
  return parseValidator(raw.validator)
}

/**
 * Returns the wrapped vesting account if the address is a vesting account,
 * otherwise null. The auth endpoint always wraps in `BaseAccount` for
 * non-vesting addresses, so we filter by `@type`.
 *
 * Used by callers that need to surface vesting state to the user (e.g.
 * "X LUNA still locked, vesting until 2024-05-26"). NOT used by the staking
 * msg builders — undelegate works on any delegated balance regardless of
 * vesting state, the contract just controls when the unbonded coins become
 * spendable post-21-day window.
 */
export async function getCosmosVestingAccount(
  chain: StakingChain,
  address: string,
  opts: FetchOpts = {}
): Promise<VestingAccount | null> {
  type Raw = { account: { '@type': string } & Record<string, unknown> }
  let raw: Raw
  try {
    raw = await lcdGet<Raw>(getAuthAccountUrl(chain, address), opts)
  } catch (e) {
    // 404 on a brand-new (zero-tx) address is normal — return null so the
    // caller doesn't have to differentiate "not found" from "not vesting".
    if (e instanceof Error && e.message.startsWith('LCD 404')) return null
    throw e
  }
  const t = raw.account['@type']
  if (
    t === '/cosmos.vesting.v1beta1.PeriodicVestingAccount' ||
    t === '/cosmos.vesting.v1beta1.ContinuousVestingAccount' ||
    t === '/cosmos.vesting.v1beta1.DelayedVestingAccount'
  ) {
    return raw.account as unknown as VestingAccount
  }
  return null
}
