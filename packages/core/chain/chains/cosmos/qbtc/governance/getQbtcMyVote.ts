import { qbtcGovBase } from './parseGov'
import { QbtcGovVote } from './proposal'
import { parseQbtcVoteOption, QbtcVoteOptionKey } from './voteOption'

type RawVoteOption = {
  option?: string
  weight?: string
}

type VoteResponse = {
  vote?: {
    options?: RawVoteOption[]
  }
}

type GetQbtcMyVoteInput = {
  proposalId: string
  voter: string
}

/**
 * The voter's recorded vote on a proposal. A 404 means "no vote yet" and
 * resolves to `null` rather than throwing.
 */
export const getQbtcMyVote = async ({ proposalId, voter }: GetQbtcMyVoteInput): Promise<QbtcGovVote | null> => {
  const response = await fetch(`${qbtcGovBase}/proposals/${proposalId}/votes/${voter}`)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Failed to fetch QBTC vote (${response.status}): ${response.statusText}`)
  }
  const data: VoteResponse = await response.json()
  const options = (data.vote?.options ?? [])
    .map(({ option, weight }) => {
      const parsed = parseQbtcVoteOption(option ?? '')
      if (!parsed) return undefined
      // Drop entries whose weight isn't a valid 0..1 fraction rather than
      // coercing to 0, which would make a malformed LCD payload look like a
      // valid vote.
      const weightFraction = Number(weight)
      if (!Number.isFinite(weightFraction) || weightFraction < 0 || weightFraction > 1) {
        return undefined
      }
      return { option: parsed, weight: weightFraction }
    })
    .filter((entry): entry is { option: QbtcVoteOptionKey; weight: number } => entry !== undefined)
  return { options }
}
