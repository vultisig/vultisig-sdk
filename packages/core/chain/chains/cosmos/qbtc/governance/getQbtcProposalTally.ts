import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { parseQbtcGovTally, qbtcGovBase, RawTally } from './parseGov'
import { QbtcGovTally } from './proposal'

type TallyResponse = {
  tally?: RawTally
}

/** Live tally for an in-voting proposal. */
export const getQbtcProposalTally = async (proposalId: string): Promise<QbtcGovTally> => {
  const data = await queryUrl<TallyResponse>(`${qbtcGovBase}/proposals/${proposalId}/tally`)
  return parseQbtcGovTally(data.tally)
}
