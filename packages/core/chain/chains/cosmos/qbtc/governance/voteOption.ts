/**
 * QBTC governance vote options, in canonical Cosmos `x/gov` order. The QBTC
 * chain reuses the standard Cosmos `VoteOption` enum, so these map 1:1 onto the
 * proto values (1=YES … 4=NO_WITH_VETO) used when building `MsgVote` /
 * `MsgVoteWeighted`.
 */
export const qbtcVoteOptionKeys = ['yes', 'abstain', 'no', 'noWithVeto'] as const

export type QbtcVoteOptionKey = (typeof qbtcVoteOptionKeys)[number]

/** Cosmos `VoteOption` proto enum value for each option. */
export const qbtcVoteOptionProtoValue: Record<QbtcVoteOptionKey, number> = {
  yes: 1,
  abstain: 2,
  no: 3,
  noWithVeto: 4,
}

/**
 * Decodes the option field returned by the gov LCD (`/votes/{voter}`), which
 * may be the proto enum name (`VOTE_OPTION_YES`) or its numeric string (`"1"`).
 * Returns `undefined` for unknown/unspecified values so callers can skip them.
 */
export const parseQbtcVoteOption = (wire: string): QbtcVoteOptionKey | undefined => {
  switch (wire) {
    case 'VOTE_OPTION_YES':
    case '1':
      return 'yes'
    case 'VOTE_OPTION_ABSTAIN':
    case '2':
      return 'abstain'
    case 'VOTE_OPTION_NO':
    case '3':
      return 'no'
    case 'VOTE_OPTION_NO_WITH_VETO':
    case '4':
      return 'noWithVeto'
    default:
      return undefined
  }
}
