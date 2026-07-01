import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { parseQbtcGovProposal, qbtcGovBase, RawProposal } from './parseGov'
import { QbtcGovProposal } from './proposal'

type ProposalsResponse = {
  proposals?: RawProposal[]
}

/**
 * Fetches QBTC governance proposals (newest first). A single page of 100 covers
 * the active set plus recent history without pagination, matching iOS.
 */
export const getQbtcProposals = async (): Promise<QbtcGovProposal[]> => {
  const data = await queryUrl<ProposalsResponse>(
    `${qbtcGovBase}/proposals?pagination.limit=100&pagination.reverse=true`
  )
  return (data.proposals ?? [])
    .map(parseQbtcGovProposal)
    .filter((proposal): proposal is QbtcGovProposal => proposal !== undefined)
}
