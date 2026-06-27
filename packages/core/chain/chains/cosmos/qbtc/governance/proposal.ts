import { QbtcVoteOptionKey } from './voteOption'

/**
 * Subset of Cosmos `x/gov` proposal statuses surfaced by the QBTC governance
 * UI. `votingPeriod` is the only votable state.
 */
export const qbtcProposalStatuses = [
  'depositPeriod',
  'votingPeriod',
  'passed',
  'rejected',
  'failed',
  'unspecified',
] as const

export type QbtcProposalStatus = (typeof qbtcProposalStatuses)[number]

/** Maps the LCD wire status (`PROPOSAL_STATUS_*`) onto our union. */
export const parseQbtcProposalStatus = (wire: string): QbtcProposalStatus => {
  switch (wire) {
    case 'PROPOSAL_STATUS_DEPOSIT_PERIOD':
      return 'depositPeriod'
    case 'PROPOSAL_STATUS_VOTING_PERIOD':
      return 'votingPeriod'
    case 'PROPOSAL_STATUS_PASSED':
      return 'passed'
    case 'PROPOSAL_STATUS_REJECTED':
      return 'rejected'
    case 'PROPOSAL_STATUS_FAILED':
      return 'failed'
    default:
      return 'unspecified'
  }
}

/** A proposal is votable only while in its voting period. */
export const isActiveQbtcProposal = (status: QbtcProposalStatus): boolean => status === 'votingPeriod'

/**
 * Tally counts in the staking base unit, keyed by option. Stored as `bigint`
 * because validator-weighted totals routinely exceed `Number.MAX_SAFE_INTEGER`;
 * the UI only ever needs their ratios.
 */
export type QbtcGovTally = Record<QbtcVoteOptionKey, bigint>

export const emptyQbtcGovTally: QbtcGovTally = {
  yes: 0n,
  abstain: 0n,
  no: 0n,
  noWithVeto: 0n,
}

export const qbtcGovTallyTotal = (tally: QbtcGovTally): bigint =>
  tally.yes + tally.abstain + tally.no + tally.noWithVeto

export type QbtcGovProposal = {
  id: string
  title: string
  summary: string
  status: QbtcProposalStatus
  /** Embedded tally — all-zero for active proposals until the live `/tally`
   * endpoint is queried. */
  finalTally: QbtcGovTally
  /** RFC3339 timestamps as returned by the chain; `undefined` if absent. */
  votingStartTime?: string
  votingEndTime?: string
  /** Wrapped message type URLs (e.g. `/cosmos.gov.v1.MsgExecLegacyContent`). */
  messageTypes: string[]
}

/** A weighted option from the voter's recorded vote (`weight` as a fraction). */
export type QbtcGovVoteOption = {
  option: QbtcVoteOptionKey
  weight: number
}

/** The voter's recorded vote on a proposal, or `null` if they haven't voted. */
export type QbtcGovVote = {
  options: QbtcGovVoteOption[]
}

export type QbtcGovParams = {
  votingPeriodSeconds?: number
  quorum?: number
  threshold?: number
  vetoThreshold?: number
}

/**
 * A user's pending vote selection, threaded through navigation to the verify
 * screen. `weightPercent` is an integer 0–100; it is normalised to an
 * 18-decimal `cosmos.Dec` string only when the `MsgVoteWeighted` is built.
 */
export type QbtcVoteSelection =
  | { kind: 'single'; option: QbtcVoteOptionKey }
  | {
      kind: 'weighted'
      options: { option: QbtcVoteOptionKey; weightPercent: number }[]
    }
