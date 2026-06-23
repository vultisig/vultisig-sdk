/**
 * Cosmos governance — read proposals + build an unsigned MsgVote envelope.
 *
 * Ported from mcp-ts `src/tools/staking/cosmos-governance.ts`
 * (`get_cosmos_governance_proposals` + `prepare_cosmos_vote`) as part of the
 * mcp-ts/backend → SDK code-as-action consolidation.
 *
 * PURE CRYPTO / READ-ONLY: `getCosmosGovernanceProposals` is a plain LCD read,
 * and `prepareCosmosVote` only *builds* an unsigned `cosmos-sdk/MsgVote`
 * envelope (with the account_number/sequence needed for offline signing). This
 * module NEVER signs and NEVER broadcasts — the caller routes the envelope
 * through the wallet's signing path.
 *
 * Chains are keyed by the SDK `IbcEnabledCosmosChain` enum and resolve their
 * LCD root from the shared `cosmosRpcUrl` registry, so there's no second
 * chain-id/REST-URL table to drift. Address validation uses `@cosmjs/encoding`
 * (already a core-chain dependency) rather than a hand-rolled bech32 decoder.
 */
import { fromBech32 } from '@cosmjs/encoding'
import { IbcEnabledCosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosChainId } from '@vultisig/core-chain/chains/cosmos/chainInfo'
import { cosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'
import { getAuthAccountUrl } from '@vultisig/core-chain/chains/cosmos/staking/lcdQueries'

// ── chain support ──────────────────────────────────────────────────────────

/** Chains this module serves governance reads/votes for. */
export type GovChain = IbcEnabledCosmosChain

/**
 * Expected bech32 HRP (human-readable prefix) per gov chain, used to reject a
 * voter address that belongs to a different chain (e.g. an `osmo1…` address
 * submitted as a Cosmos Hub vote). No centralized HRP map exists in core-chain,
 * so it's declared here for the small, stable set of gov chains.
 */
const CHAIN_HRP: Record<GovChain, string> = {
  Cosmos: 'cosmos',
  Osmosis: 'osmo',
  Dydx: 'dydx',
  Kujira: 'kujira',
  Terra: 'terra',
  TerraClassic: 'terra',
  Noble: 'noble',
  Akash: 'akash',
}

/**
 * Whether a chain serves the modern `gov/v1` endpoint. TerraClassic
 * (columbus-5) runs an older Cosmos SDK and only exposes `gov/v1beta1`; the
 * rest prefer `gov/v1` and fall back to `v1beta1` on 404/501.
 */
const GOV_V1: Record<GovChain, boolean> = {
  Cosmos: true,
  Osmosis: true,
  Dydx: true,
  Kujira: true,
  Terra: true,
  TerraClassic: false,
  Noble: true,
  Akash: true,
}

const isGovChain = (chain: string): chain is GovChain => Object.prototype.hasOwnProperty.call(CHAIN_HRP, chain)

const SUPPORTED_CHAINS = Object.keys(CHAIN_HRP).sort().join(', ')

const lcdRoot = (chain: GovChain): string => cosmosRpcUrl[chain]

// ── proposal status maps ────────────────────────────────────────────────────

export type ProposalStatus = 'voting' | 'passed' | 'rejected' | 'deposit_period' | 'all'

const STATUS_V1: Record<ProposalStatus, string> = {
  voting: 'PROPOSAL_STATUS_VOTING_PERIOD',
  passed: 'PROPOSAL_STATUS_PASSED',
  rejected: 'PROPOSAL_STATUS_REJECTED',
  deposit_period: 'PROPOSAL_STATUS_DEPOSIT_PERIOD',
  all: '', // empty = no filter
}

const STATUS_V1BETA1: Record<ProposalStatus, string> = {
  voting: 'PROPOSAL_STATUS_VOTING_PERIOD',
  passed: 'PROPOSAL_STATUS_PASSED',
  rejected: 'PROPOSAL_STATUS_REJECTED',
  deposit_period: 'PROPOSAL_STATUS_DEPOSIT_PERIOD',
  all: '0',
}

// ── vote option map ──────────────────────────────────────────────────────────

export type VoteOption = 'yes' | 'no' | 'abstain' | 'no_with_veto'

/**
 * SDK/app-canonical vote option constants (cosmos-sdk/MsgVote contract). The
 * envelope ships the `VOTE_OPTION_*` string form (not the numeric enum) so the
 * app's signAndBroadcast path can route it without a conversion step.
 */
const VOTE_OPTION_STRINGS: Record<VoteOption, string> = {
  yes: 'VOTE_OPTION_YES',
  no: 'VOTE_OPTION_NO',
  abstain: 'VOTE_OPTION_ABSTAIN',
  no_with_veto: 'VOTE_OPTION_NO_WITH_VETO',
}

// ── result shapes ────────────────────────────────────────────────────────────

export type VoteTally = {
  yes: string
  no: string
  abstain: string
  no_with_veto: string
}

export type GovernanceProposal = {
  proposalId: string
  title: string
  summary: string
  status: string
  votingStartTime: string
  votingEndTime: string
  voteTally: VoteTally
}

export type GetGovernanceProposalsResult = {
  chain: GovChain
  chainId: string
  status: ProposalStatus
  count: number
  proposals: GovernanceProposal[]
}

export type CosmosVoteEnvelope = {
  /** cosmos-sdk message type — the app's signAndBroadcast routes on this. */
  type: 'cosmos-sdk/MsgVote'
  action: 'governance_vote'
  signingMode: 'ecdsa_secp256k1'
  chain: GovChain
  chainId: string
  /** Normalized (re-encoded) bech32 voter address. */
  voter: string
  proposalId: string
  /** Human option key (`yes` | `no` | `abstain` | `no_with_veto`). */
  option: VoteOption
  /** `VOTE_OPTION_*` string constant matching `option`. */
  voteOption: string
  accountNumber: string
  sequence: string
  metadata?: string
}

// ── LCD raw shapes ───────────────────────────────────────────────────────────

type GovV1Response = {
  proposals?: Array<{
    id: string
    title?: string
    summary?: string
    status: string
    voting_start_time?: string
    voting_end_time?: string
    final_tally_result?: {
      yes_count?: string
      no_count?: string
      abstain_count?: string
      no_with_veto_count?: string
    }
    messages?: Array<{ content?: { title?: string; description?: string } }>
  }>
}

type GovV1Beta1Response = {
  proposals?: Array<{
    proposal_id: string
    content?: { title?: string; description?: string }
    status: string
    voting_start_time?: string
    voting_end_time?: string
    final_tally_result?: {
      yes?: string
      no?: string
      abstain?: string
      no_with_veto?: string
    }
  }>
}

type AuthAccountResponse = {
  account?: {
    account_number?: string | number
    sequence?: string | number
    base_account?: { account_number?: string | number; sequence?: string | number }
    base_vesting_account?: {
      base_account?: { account_number?: string | number; sequence?: string | number }
    }
    [key: string]: unknown
  }
}

// ── fetch helper (raw fetch — works in RN + Node + browser) ──────────────────

type FetchOpts = { fetchImpl?: typeof fetch; signal?: AbortSignal }

async function lcdGet<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const f = opts.fetchImpl ?? fetch
  const res = await f(url, { signal: opts.signal })
  if (!res.ok) {
    // 404 on /auth/accounts/{addr} for an unseen address is legitimate; the
    // status is surfaced so callers can branch on `message.includes('404')`.
    throw new Error(`LCD ${res.status}: ${url}`)
  }
  return (await res.json()) as T
}

// ── proposal fetchers ────────────────────────────────────────────────────────

async function fetchProposalsV1(
  chain: GovChain,
  status: ProposalStatus,
  limit: number,
  opts: FetchOpts
): Promise<GovernanceProposal[]> {
  const statusParam = STATUS_V1[status]
  let url = `${lcdRoot(chain)}/cosmos/gov/v1/proposals?pagination.limit=${limit}`
  if (statusParam) url += `&proposal_status=${encodeURIComponent(statusParam)}`
  const resp = await lcdGet<GovV1Response>(url, opts)
  return (resp.proposals ?? []).map(p => ({
    proposalId: p.id,
    title: p.title || p.messages?.[0]?.content?.title || '',
    summary: p.summary || p.messages?.[0]?.content?.description || '',
    status: p.status,
    votingStartTime: p.voting_start_time ?? '',
    votingEndTime: p.voting_end_time ?? '',
    voteTally: {
      yes: p.final_tally_result?.yes_count ?? '0',
      no: p.final_tally_result?.no_count ?? '0',
      abstain: p.final_tally_result?.abstain_count ?? '0',
      no_with_veto: p.final_tally_result?.no_with_veto_count ?? '0',
    },
  }))
}

async function fetchProposalsV1Beta1(
  chain: GovChain,
  status: ProposalStatus,
  limit: number,
  opts: FetchOpts
): Promise<GovernanceProposal[]> {
  const statusParam = STATUS_V1BETA1[status]
  const url =
    `${lcdRoot(chain)}/cosmos/gov/v1beta1/proposals` +
    `?pagination.limit=${limit}&proposal_status=${encodeURIComponent(statusParam)}`
  const resp = await lcdGet<GovV1Beta1Response>(url, opts)
  return (resp.proposals ?? []).map(p => ({
    proposalId: p.proposal_id,
    title: p.content?.title ?? '',
    summary: p.content?.description ?? '',
    status: p.status,
    votingStartTime: p.voting_start_time ?? '',
    votingEndTime: p.voting_end_time ?? '',
    voteTally: {
      yes: p.final_tally_result?.yes ?? '0',
      no: p.final_tally_result?.no ?? '0',
      abstain: p.final_tally_result?.abstain ?? '0',
      no_with_veto: p.final_tally_result?.no_with_veto ?? '0',
    },
  }))
}

const isNotImplemented = (msg: string): boolean =>
  msg.includes('404') || msg.includes('501') || msg.includes('Not Found') || msg.includes('Not Implemented')

// ── auth account parser ──────────────────────────────────────────────────────

/**
 * Walk the three known account nesting shapes (vesting → module → base) and
 * return account_number/sequence. Returns null on unknown/incomplete shape so
 * the caller can fail closed rather than ship a vote with sequence=0 against a
 * funded account (which the chain rejects with code 32 "sequence mismatch").
 */
function parseAuthAccount(resp: AuthAccountResponse): { accountNumber: string; sequence: string } | null {
  const acct = resp.account
  if (!acct) return null

  const vesting = acct.base_vesting_account?.base_account
  if (vesting?.account_number != null) {
    if (vesting.sequence == null) return null
    return { accountNumber: String(vesting.account_number), sequence: String(vesting.sequence) }
  }

  const moduleBase = acct.base_account
  if (moduleBase?.account_number != null) {
    if (moduleBase.sequence == null) return null
    return { accountNumber: String(moduleBase.account_number), sequence: String(moduleBase.sequence) }
  }

  if (acct.account_number != null) {
    if (acct.sequence == null) return null
    return { accountNumber: String(acct.account_number), sequence: String(acct.sequence) }
  }

  return null
}

// ── public: read proposals ───────────────────────────────────────────────────

export type GetCosmosGovernanceProposalsParams = {
  chain: GovChain
  /** Status filter. Defaults to `voting`. */
  status?: ProposalStatus
  /** Max proposals per page (1-100, default 20). */
  limit?: number
} & FetchOpts

/**
 * Fetch governance proposals from any IBC-enabled Cosmos chain (single page,
 * max 100). Prefers `gov/v1`; falls back to `gov/v1beta1` only when the node
 * returns 404/501 (older SDK). Read-only — no signing, no broadcast.
 *
 * @example
 * ```ts
 * const { proposals } = await getCosmosGovernanceProposals({
 *   chain: 'Osmosis',
 *   status: 'voting',
 *   limit: 5,
 * })
 * ```
 */
export async function getCosmosGovernanceProposals(
  params: GetCosmosGovernanceProposalsParams
): Promise<GetGovernanceProposalsResult> {
  const { chain, status = 'voting', limit: rawLimit, fetchImpl, signal } = params
  if (!isGovChain(chain)) {
    throw new Error(`unsupported chain "${chain}" — supported: ${SUPPORTED_CHAINS}`)
  }
  const limit = Math.min(Math.max(rawLimit ?? 20, 1), 100)
  const opts: FetchOpts = { fetchImpl, signal }

  let proposals: GovernanceProposal[]
  if (GOV_V1[chain]) {
    try {
      proposals = await fetchProposalsV1(chain, status, limit, opts)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (isNotImplemented(msg)) {
        proposals = await fetchProposalsV1Beta1(chain, status, limit, opts)
      } else {
        throw e
      }
    }
  } else {
    proposals = await fetchProposalsV1Beta1(chain, status, limit, opts)
  }

  return {
    chain,
    chainId: getCosmosChainId(chain),
    status,
    count: proposals.length,
    proposals,
  }
}

// ── public: build unsigned vote envelope ─────────────────────────────────────

export type PrepareCosmosVoteParams = {
  chain: GovChain
  /** Bech32 voter address (HRP must match the chain). */
  voter: string
  /** Governance proposal ID (positive integer string, e.g. "42"). */
  proposalId: string
  option: VoteOption
  /** Optional short metadata string (e.g. a justification note). */
  metadata?: string
} & FetchOpts

/**
 * Build an unsigned `cosmos-sdk/MsgVote` envelope for a governance vote on any
 * IBC-enabled Cosmos chain. Validates the voter address (bech32 + chain HRP),
 * fetches account_number/sequence from the LCD (fail-closed on funded accounts
 * whose shape can't be parsed), and returns the envelope the wallet signs.
 *
 * BUILDS-UNSIGNED ONLY — this never signs and never broadcasts.
 *
 * @example
 * ```ts
 * const env = await prepareCosmosVote({
 *   chain: 'Osmosis',
 *   voter: 'osmo1...',
 *   proposalId: '925',
 *   option: 'yes',
 * })
 * // → { type: 'cosmos-sdk/MsgVote', voteOption: 'VOTE_OPTION_YES', ... }
 * ```
 */
export async function prepareCosmosVote(params: PrepareCosmosVoteParams): Promise<CosmosVoteEnvelope> {
  const { chain, voter: rawVoter, proposalId, option, metadata, fetchImpl, signal } = params

  if (!isGovChain(chain)) {
    throw new Error(`unsupported chain "${chain}" — supported: ${SUPPORTED_CHAINS}`)
  }

  // Validate voter bech32 address + chain HRP, then normalize (re-encode).
  const expectedHrp = CHAIN_HRP[chain]
  let decoded: ReturnType<typeof fromBech32>
  try {
    decoded = fromBech32(rawVoter.trim())
  } catch (e) {
    throw new Error(`invalid voter address: malformed bech32 (${e instanceof Error ? e.message : String(e)})`)
  }
  if (decoded.prefix !== expectedHrp) {
    throw new Error(
      `invalid voter address: prefix "${decoded.prefix}" does not match expected "${expectedHrp}" for ${chain}`
    )
  }
  if (decoded.data.length !== 20 && decoded.data.length !== 32) {
    throw new Error(`invalid voter address: expected 20- or 32-byte payload, got ${decoded.data.length}`)
  }
  const voter = rawVoter.trim()

  if (!/^\d+$/.test(proposalId) || Number(proposalId) <= 0) {
    throw new Error(`invalid proposalId "${proposalId}": must be a positive integer string`)
  }

  const voteOption = VOTE_OPTION_STRINGS[option]
  if (!voteOption) {
    throw new Error(`invalid option "${option}" — must be one of: ${Object.keys(VOTE_OPTION_STRINGS).join(', ')}`)
  }

  // Fetch account_number + sequence. Fail closed: any LCD failure other than a
  // 404 (genuinely new account → 0/0 is correct) throws, so the caller retries
  // rather than building a vote with sequence=0 against a funded account.
  let accountNumber = '0'
  let sequence = '0'
  try {
    const resp = await lcdGet<AuthAccountResponse>(getAuthAccountUrl(chain, voter), { fetchImpl, signal })
    const parsed = parseAuthAccount(resp)
    if (parsed) {
      accountNumber = parsed.accountNumber
      sequence = parsed.sequence
    } else if (resp.account && Object.keys(resp.account).length > 0) {
      throw new Error(
        `account exists for ${voter} but sequence could not be parsed ` +
          `(keys: ${Object.keys(resp.account).join(', ')}); try again`
      )
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // `LCD 404: ...` = new account, 0/0 is the correct initial state.
    if (!/^LCD 404:/.test(msg)) {
      throw e instanceof Error ? e : new Error(`couldn't fetch account state for ${voter}, try again`)
    }
  }

  const envelope: CosmosVoteEnvelope = {
    type: 'cosmos-sdk/MsgVote',
    action: 'governance_vote',
    signingMode: 'ecdsa_secp256k1',
    chain,
    chainId: getCosmosChainId(chain),
    voter,
    proposalId,
    option,
    voteOption,
    accountNumber,
    sequence,
  }
  if (metadata) envelope.metadata = metadata
  return envelope
}
