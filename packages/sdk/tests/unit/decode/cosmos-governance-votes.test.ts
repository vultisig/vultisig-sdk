import { MsgVote as MsgVoteV1 } from 'cosmjs-types/cosmos/gov/v1/tx'
import { MsgVote as MsgVoteV1Beta1 } from 'cosmjs-types/cosmos/gov/v1beta1/tx'
import { TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { describe, expect, it, vi } from 'vitest'

import { prepareCosmosVote } from '@/tools/cosmos/gov'
import { decodeFromToolResult } from '@/tools/decode'

const OSMO_VOTER = 'osmo1runz6dpmgfy4q467v4k8x75p3z8ed8dyxqlpht'

// Golden TxRaw fixtures are pinned independently of the decoder so changes to
// the decoder cannot silently rewrite the wire contract under test.
const VOTE_V1_TX_BASE64 =
  'CmAKXgoWL2Nvc21vcy5nb3YudjEuTXNnVm90ZRJECJ0HEitvc21vMXJ1bno2ZHBtZ2Z5NHE0Njd2NGs4eDc1cDN6OGVkOGR5eHFscGh0GAEiEGlwZnM6Ly92b3RlLW5vdGU='
const VOTE_V1BETA1_TX_BASE64 =
  'ClIKUAobL2Nvc21vcy5nb3YudjFiZXRhMS5Nc2dWb3RlEjEIKhIrb3NtbzFydW56NmRwbWdmeTRxNDY3djRrOHg3NXAzejhlZDhkeXhxbHBodBgE'

const decodeFixture = (payload: string) => decodeFromToolResult({ family: 'cosmos', chain: 'osmosis-1', payload })

const encodeTx = (typeUrl: string, value: Uint8Array) =>
  Buffer.from(
    TxRaw.encode(
      TxRaw.fromPartial({ bodyBytes: TxBody.encode(TxBody.fromPartial({ messages: [{ typeUrl, value }] })).finish() })
    ).finish()
  ).toString('base64')

describe('decodeFromToolResult — Cosmos governance votes', () => {
  it('decodes gov/v1 fields into the same canonical values prepared by prepareCosmosVote', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ account: { account_number: '123456', sequence: '7' } }),
    })) as unknown as typeof fetch
    const prepared = await prepareCosmosVote({
      chain: 'Osmosis',
      voter: OSMO_VOTER,
      proposalId: '925',
      option: 'yes',
      metadata: 'ipfs://vote-note',
      fetchImpl,
    })

    expect(decodeFixture(VOTE_V1_TX_BASE64)).toMatchObject({
      decoded: true,
      kind: 'vote',
      recipient: '',
      amount: '',
      asset: { symbol: '', contract: '', decimals: 0 },
      spender: '',
      cosmosAction: {
        type: 'vote',
        voterAddress: prepared.voter,
        proposalId: prepared.proposalId,
        voteOption: prepared.voteOption,
        metadata: prepared.metadata,
      },
    })
  })

  it('decodes the legacy gov/v1beta1 shape without inventing v1 metadata', () => {
    const envelope = decodeFixture(VOTE_V1BETA1_TX_BASE64)

    expect(envelope).toMatchObject({
      decoded: true,
      kind: 'vote',
      recipient: '',
      amount: '',
      cosmosAction: {
        type: 'vote',
        voterAddress: OSMO_VOTER,
        proposalId: '42',
        voteOption: 'VOTE_OPTION_NO_WITH_VETO',
      },
    })
    expect(envelope.cosmosAction).not.toHaveProperty('metadata')
  })

  describe.each(['v1', 'v1beta1'] as const)('%s boundaries', version => {
    const typeUrl = `/cosmos.gov.${version}.MsgVote`
    const encodeVote = (option: number) => {
      const vote = { proposalId: 18446744073709551615n, voter: OSMO_VOTER, option }
      return encodeTx(
        typeUrl,
        version === 'v1'
          ? MsgVoteV1.encode(MsgVoteV1.fromPartial(vote)).finish()
          : MsgVoteV1Beta1.encode(MsgVoteV1Beta1.fromPartial(vote)).finish()
      )
    }

    it.each([
      [1, 'VOTE_OPTION_YES'],
      [2, 'VOTE_OPTION_ABSTAIN'],
      [3, 'VOTE_OPTION_NO'],
      [4, 'VOTE_OPTION_NO_WITH_VETO'],
    ])('preserves option %i and uint64 proposal precision', (option, voteOption) => {
      const envelope = decodeFixture(encodeVote(option as number))
      expect(envelope.decoded).toBe(true)
      expect(envelope.cosmosAction).toEqual({
        type: 'vote',
        voterAddress: OSMO_VOTER,
        proposalId: '18446744073709551615',
        voteOption,
        ...(version === 'v1' ? { metadata: '' } : {}),
      })
    })

    it.each([0, 5, -1])('fails closed for unsupported option %i', option => {
      const envelope = decodeFixture(encodeVote(option))
      expect(envelope).toMatchObject({ decoded: false, kind: 'unknown' })
      expect(envelope.decodeError).toContain('unsupported governance vote option')
      expect(envelope.cosmosAction).toBeUndefined()
    })

    it('returns a failed envelope for a truncated vote message', () => {
      const envelope = decodeFixture(encodeTx(typeUrl, Uint8Array.from([0x12, 0x05, 0x61])))
      expect(envelope).toMatchObject({ decoded: false, kind: 'unknown' })
      expect(envelope.cosmosAction).toBeUndefined()
    })
  })

  it('reads changed voter, proposal, option and metadata from the wire, not caller args', () => {
    const vote = { proposalId: 926n, voter: 'another-voter', option: 3, metadata: 'Changed metadata ✓' }
    const payload = encodeTx('/cosmos.gov.v1.MsgVote', MsgVoteV1.encode(MsgVoteV1.fromPartial(vote)).finish())
    const envelope = decodeFromToolResult({
      family: 'cosmos',
      chain: 'osmosis-1',
      payload,
      args: { voter: OSMO_VOTER, proposalId: '925', option: 'yes', metadata: 'ipfs://vote-note' },
    })
    expect(envelope.cosmosAction).toEqual({
      type: 'vote',
      voterAddress: vote.voter,
      proposalId: '926',
      voteOption: 'VOTE_OPTION_NO',
      metadata: vote.metadata,
    })
  })

  it.each(['token', 'token_symbol', 'asset', 'symbol', 'ticker'])('does not invent a vote asset from args.%s', key => {
    for (const payload of [VOTE_V1_TX_BASE64, VOTE_V1BETA1_TX_BASE64]) {
      const envelope = decodeFromToolResult({
        family: 'cosmos',
        chain: 'osmosis-1',
        payload,
        args: { [key]: 'USDC' },
      })
      expect(envelope).toMatchObject({
        decoded: true,
        kind: 'vote',
        recipient: '',
        amount: '',
        spender: '',
        asset: { symbol: '', contract: '', decimals: 0 },
      })
    }
  })
})
