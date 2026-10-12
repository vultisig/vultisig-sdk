import { parseUint64 } from '../parseUint64'

/** dYdX governance ballots, in canonical Cosmos `x/gov` order. */
export const dydxVoteOptions = ['yes', 'abstain', 'no', 'noWithVeto'] as const

/** One of the ballots a dYdX governance vote can cast. */
export type DydxVoteOption = (typeof dydxVoteOptions)[number]

/** A dYdX governance vote as carried in a keysign payload memo. */
export type DydxVote = {
  option: DydxVoteOption
  proposalId: bigint
}

const dydxVoteMemoPrefix = 'DYDX_VOTE'

// Co-signers match on this token, so it stays byte-identical to iOS
// `DydxVoteOption.memoValue` — spaces in "No with Veto" included.
const memoTokenByOption: Record<DydxVoteOption, string> = {
  yes: 'Yes',
  abstain: 'Abstain',
  no: 'No',
  noWithVeto: 'No with Veto',
}

/**
 * Encodes a vote as `DYDX_VOTE:<option>:<proposalId>`, the memo every signer
 * (iOS `DydxHelperStruct`, this SDK's Cosmos resolver) turns into a `MsgVote`.
 */
export const toDydxVoteMemo = ({ option, proposalId }: DydxVote): string =>
  [dydxVoteMemoPrefix, memoTokenByOption[option], proposalId.toString()].join(':')

/**
 * Decodes a `DYDX_VOTE:<option>:<proposalId>` memo. Throws on anything else: a
 * ballot that does not parse must never be signed as some other message.
 */
export const parseDydxVoteMemo = (memo: string): DydxVote => {
  const parts = memo.split(':')
  const [prefix, token, proposalId] = parts

  if (parts.length !== 3 || prefix !== dydxVoteMemoPrefix) {
    throw new Error(`Invalid dYdX vote memo "${memo}": expected ${dydxVoteMemoPrefix}:<option>:<proposalId>`)
  }

  const option = dydxVoteOptions.find(option => memoTokenByOption[option] === token)
  if (!option) {
    throw new Error(
      `Invalid dYdX vote option "${token}": expected one of ${dydxVoteOptions.map(option => memoTokenByOption[option]).join(', ')}`
    )
  }

  return {
    option,
    proposalId: parseUint64({ value: proposalId, field: 'proposalId', context: 'dYdX vote memo' }),
  }
}
