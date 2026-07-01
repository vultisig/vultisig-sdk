import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { govToFraction, qbtcGovBase } from './parseGov'
import { QbtcGovParams } from './proposal'

type ParamsResponse = {
  voting_params?: { voting_period?: string }
  params?: {
    voting_period?: string
    quorum?: string
    threshold?: string
    veto_threshold?: string
  }
  tally_params?: {
    quorum?: string
    threshold?: string
    veto_threshold?: string
  }
}

const parseVotingPeriodSeconds = (raw?: string): number | undefined => {
  if (typeof raw !== 'string') return undefined
  // Cosmos durations arrive as e.g. `"172800s"`.
  const seconds = Number(raw.replace(/s$/, ''))
  return Number.isFinite(seconds) ? seconds : undefined
}

/**
 * Governance params used for the detail screen's quorum hint and as a fallback
 * voting-window length. Voting and tallying params live at different endpoints
 * across SDK versions, so both are fetched and merged; failures are tolerated.
 */
export const getQbtcGovParams = async (): Promise<QbtcGovParams> => {
  const [votingResult, tallyingResult] = await Promise.all([
    attempt(() => queryUrl<ParamsResponse>(`${qbtcGovBase}/params/voting`)),
    attempt(() => queryUrl<ParamsResponse>(`${qbtcGovBase}/params/tallying`)),
  ])

  const voting = 'data' in votingResult ? votingResult.data : undefined
  const tallying = 'data' in tallyingResult ? tallyingResult.data : undefined

  const tallyParams = tallying?.tally_params ?? tallying?.params ?? voting?.params
  return {
    votingPeriodSeconds: parseVotingPeriodSeconds(
      voting?.voting_params?.voting_period ?? voting?.params?.voting_period
    ),
    quorum: govToFraction(tallyParams?.quorum),
    threshold: govToFraction(tallyParams?.threshold),
    vetoThreshold: govToFraction(tallyParams?.veto_threshold),
  }
}
