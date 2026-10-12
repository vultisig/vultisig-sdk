import { describe, expect, it } from 'vitest'

import { dydxVoteOptions, parseDydxVoteMemo, toDydxVoteMemo } from './dydxVoteMemo'

describe('dYdX vote memo', () => {
  // Byte-for-byte what iOS DydxVoteTransactionBuilder writes; an iOS co-signer
  // parses these exact strings, so any drift breaks cross-device signing.
  it.each([
    ['yes', 'DYDX_VOTE:Yes:42'],
    ['abstain', 'DYDX_VOTE:Abstain:42'],
    ['no', 'DYDX_VOTE:No:42'],
    ['noWithVeto', 'DYDX_VOTE:No with Veto:42'],
  ] as const)('encodes %s as %s', (option, memo) => {
    expect(toDydxVoteMemo({ option, proposalId: 42n })).toBe(memo)
  })

  it('round-trips every option', () => {
    for (const option of dydxVoteOptions) {
      const vote = { option, proposalId: 18446744073709551615n }
      expect(parseDydxVoteMemo(toDydxVoteMemo(vote))).toEqual(vote)
    }
  })

  it.each([
    ['the bare legacy memo', 'VOTE'],
    ['a missing proposal id', 'DYDX_VOTE:Yes'],
    ['an extra field', 'DYDX_VOTE:Yes:1:2'],
    ['another chain prefix', 'QBTC_VOTE:Yes:1'],
    ['the unspecified option', 'DYDX_VOTE:Unspecified:1'],
    ['a differently cased option', 'DYDX_VOTE:YES:1'],
    ['a negative proposal id', 'DYDX_VOTE:Yes:-1'],
    ['a non-numeric proposal id', 'DYDX_VOTE:Yes:abc'],
    ['a proposal id above uint64', 'DYDX_VOTE:Yes:18446744073709551616'],
  ])('rejects %s', (_, memo) => {
    expect(() => parseDydxVoteMemo(memo)).toThrow()
  })

  // The encoder holds the parser's bounds, so no initiator can build a memo
  // every signer would refuse.
  it.each([
    ['a negative proposal id', -1n],
    ['a proposal id above uint64', 18446744073709551616n],
  ])('refuses to encode %s', (_, proposalId) => {
    expect(() => toDydxVoteMemo({ option: 'yes', proposalId })).toThrow(/dYdX vote proposalId/)
  })
})
