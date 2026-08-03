import { qbtcRestUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'
import { attempt } from '@vultisig/lib-utils/attempt'

import { emptyQbtcGovTally, parseQbtcProposalStatus, QbtcGovProposal, QbtcGovTally } from './proposal'

/** Base path for the Cosmos `x/gov v1` REST endpoints on the QBTC node. */
export const qbtcGovBase = `${qbtcRestUrl}/cosmos/gov/v1`

export const govToBigInt = (value: unknown): bigint => {
  if (typeof value !== 'string' || value.length === 0) return 0n
  const parsed = attempt(() => BigInt(value))
  if ('error' in parsed) return 0n
  return parsed.data >= 0n ? parsed.data : 0n
}

export const govToFraction = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export type RawTally = {
  yes_count?: string
  abstain_count?: string
  no_count?: string
  no_with_veto_count?: string
}

export const parseQbtcGovTally = (raw: RawTally | undefined): QbtcGovTally => {
  if (!raw) return emptyQbtcGovTally
  return {
    yes: govToBigInt(raw.yes_count),
    abstain: govToBigInt(raw.abstain_count),
    no: govToBigInt(raw.no_count),
    noWithVeto: govToBigInt(raw.no_with_veto_count),
  }
}

export type RawProposal = {
  id?: string
  title?: string
  summary?: string
  status?: string
  final_tally_result?: RawTally
  voting_start_time?: string
  voting_end_time?: string
  messages?: { '@type'?: string }[]
}

export const parseQbtcGovProposal = (raw: RawProposal): QbtcGovProposal | undefined => {
  if (typeof raw.id !== 'string' || raw.id.length === 0) return undefined
  return {
    id: raw.id,
    title: raw.title ?? '',
    summary: raw.summary ?? '',
    status: parseQbtcProposalStatus(raw.status ?? ''),
    finalTally: parseQbtcGovTally(raw.final_tally_result),
    votingStartTime: raw.voting_start_time,
    votingEndTime: raw.voting_end_time,
    messageTypes: (raw.messages ?? [])
      .map(message => message['@type'])
      .filter((type): type is string => typeof type === 'string'),
  }
}
