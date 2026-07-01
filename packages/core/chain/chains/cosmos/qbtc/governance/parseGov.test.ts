import { describe, expect, it } from 'vitest'

import { parseQbtcGovProposal, parseQbtcGovTally } from './parseGov'

describe('parseQbtcGovTally', () => {
  it('parses count strings into bigints, defaulting missing fields to 0', () => {
    expect(
      parseQbtcGovTally({
        yes_count: '1000000',
        no_count: '250000',
        no_with_veto_count: '5',
      })
    ).toEqual({ yes: 1_000_000n, abstain: 0n, no: 250_000n, noWithVeto: 5n })
  })

  it('returns an all-zero tally for missing input', () => {
    expect(parseQbtcGovTally(undefined)).toEqual({
      yes: 0n,
      abstain: 0n,
      no: 0n,
      noWithVeto: 0n,
    })
  })
})

describe('parseQbtcGovProposal', () => {
  it('maps an LCD proposal onto the domain shape', () => {
    const proposal = parseQbtcGovProposal({
      id: '42',
      title: 'Raise block size',
      summary: 'A summary',
      status: 'PROPOSAL_STATUS_VOTING_PERIOD',
      final_tally_result: {
        yes_count: '10',
        abstain_count: '0',
        no_count: '2',
        no_with_veto_count: '0',
      },
      voting_start_time: '2026-01-01T00:00:00Z',
      voting_end_time: '2026-01-03T00:00:00Z',
      messages: [{ '@type': '/cosmos.gov.v1.MsgExecLegacyContent' }],
    })

    expect(proposal).toEqual({
      id: '42',
      title: 'Raise block size',
      summary: 'A summary',
      status: 'votingPeriod',
      finalTally: { yes: 10n, abstain: 0n, no: 2n, noWithVeto: 0n },
      votingStartTime: '2026-01-01T00:00:00Z',
      votingEndTime: '2026-01-03T00:00:00Z',
      messageTypes: ['/cosmos.gov.v1.MsgExecLegacyContent'],
    })
  })

  it('drops proposals without an id', () => {
    expect(parseQbtcGovProposal({ title: 'no id' })).toBeUndefined()
  })

  it('maps unknown statuses to "unspecified"', () => {
    expect(parseQbtcGovProposal({ id: '1', status: 'WAT' })?.status).toBe('unspecified')
  })
})
