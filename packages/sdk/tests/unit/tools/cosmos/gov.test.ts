import { describe, expect, it, vi } from 'vitest'

import { getCosmosGovernanceProposals, prepareCosmosVote } from '@/tools/cosmos/gov'

// Deterministic valid bech32 test addresses (20-byte payloads).
const COSMOS_ADDR = 'cosmos1qurswpc8qurswpc8qurswpc8qurswpc8nn86qp'
const OSMO_ADDR = 'osmo1qurswpc8qurswpc8qurswpc8qurswpc8mg52kn'

/** Build a fetch stub that returns `body` (JSON) for any URL matching `match`. */
function mockFetch(routes: Array<{ match: RegExp; status?: number; body: unknown }>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const route = routes.find(r => r.match.test(url))
    if (!route) throw new Error(`unexpected fetch: ${url}`)
    const status = route.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route.body,
    } as Response
  }) as unknown as typeof fetch
}

describe('getCosmosGovernanceProposals', () => {
  it('parses a gov/v1 response (Osmosis)', async () => {
    const fetchImpl = mockFetch([
      {
        match: /\/cosmos\/gov\/v1\/proposals/,
        body: {
          proposals: [
            {
              id: '925',
              title: 'Increase staking rewards',
              summary: 'A proposal summary',
              status: 'PROPOSAL_STATUS_VOTING_PERIOD',
              voting_start_time: '2026-06-01T00:00:00Z',
              voting_end_time: '2026-06-14T00:00:00Z',
              final_tally_result: {
                yes_count: '100',
                no_count: '5',
                abstain_count: '2',
                no_with_veto_count: '1',
              },
            },
          ],
        },
      },
    ])

    const res = await getCosmosGovernanceProposals({ chain: 'Osmosis', status: 'voting', limit: 5, fetchImpl })

    expect(res.chain).toBe('Osmosis')
    expect(res.chainId).toBe('osmosis-1')
    expect(res.count).toBe(1)
    expect(res.proposals[0]).toMatchObject({
      proposalId: '925',
      title: 'Increase staking rewards',
      status: 'PROPOSAL_STATUS_VOTING_PERIOD',
      voteTally: { yes: '100', no: '5', abstain: '2', no_with_veto: '1' },
    })
  })

  it('falls back from gov/v1 (404) to gov/v1beta1', async () => {
    const fetchImpl = mockFetch([
      { match: /\/cosmos\/gov\/v1\/proposals/, status: 404, body: {} },
      {
        match: /\/cosmos\/gov\/v1beta1\/proposals/,
        body: {
          proposals: [
            {
              proposal_id: '42',
              content: { title: 'Legacy prop', description: 'old SDK' },
              status: 'PROPOSAL_STATUS_PASSED',
              final_tally_result: { yes: '7', no: '0', abstain: '0', no_with_veto: '0' },
            },
          ],
        },
      },
    ])

    const res = await getCosmosGovernanceProposals({ chain: 'Cosmos', status: 'passed', fetchImpl })
    expect(res.proposals[0]).toMatchObject({ proposalId: '42', title: 'Legacy prop' })
  })

  it('uses gov/v1beta1 directly for TerraClassic', async () => {
    const fetchImpl = mockFetch([
      {
        match: /\/cosmos\/gov\/v1beta1\/proposals/,
        body: { proposals: [] },
      },
    ])
    const res = await getCosmosGovernanceProposals({ chain: 'TerraClassic', fetchImpl })
    expect(res.chainId).toBe('columbus-5')
    expect(res.count).toBe(0)
  })

  it('rejects an unsupported chain', async () => {
    await expect(
      // @ts-expect-error — intentionally passing a non-gov chain
      getCosmosGovernanceProposals({ chain: 'Bitcoin' })
    ).rejects.toThrow(/unsupported chain/)
  })
})

describe('prepareCosmosVote', () => {
  const authRoute = (accountNumber: string, sequence: string) => ({
    match: /\/cosmos\/auth\/v1beta1\/accounts\//,
    body: { account: { account_number: accountNumber, sequence } },
  })

  it('builds a MsgVote envelope with VOTE_OPTION_* + account state', async () => {
    const fetchImpl = mockFetch([authRoute('123456', '7')])

    const env = await prepareCosmosVote({
      chain: 'Osmosis',
      voter: OSMO_ADDR,
      proposalId: '925',
      option: 'yes',
      fetchImpl,
    })

    expect(env).toMatchObject({
      type: 'cosmos-sdk/MsgVote',
      action: 'governance_vote',
      signingMode: 'ecdsa_secp256k1',
      chain: 'Osmosis',
      chainId: 'osmosis-1',
      voter: OSMO_ADDR,
      proposalId: '925',
      option: 'yes',
      voteOption: 'VOTE_OPTION_YES',
      accountNumber: '123456',
      sequence: '7',
    })
    expect(env.metadata).toBeUndefined()
  })

  it('maps every vote option to its VOTE_OPTION_* constant', async () => {
    const fetchImpl = mockFetch([authRoute('1', '0')])
    const expected: Record<string, string> = {
      yes: 'VOTE_OPTION_YES',
      no: 'VOTE_OPTION_NO',
      abstain: 'VOTE_OPTION_ABSTAIN',
      no_with_veto: 'VOTE_OPTION_NO_WITH_VETO',
    }
    for (const [opt, voteOption] of Object.entries(expected)) {
      const env = await prepareCosmosVote({
        chain: 'Cosmos',
        voter: COSMOS_ADDR,
        proposalId: '1',
        option: opt as 'yes',
        fetchImpl,
      })
      expect(env.voteOption).toBe(voteOption)
    }
  })

  it('treats a 404 account as a fresh account (0/0)', async () => {
    const fetchImpl = mockFetch([{ match: /\/accounts\//, status: 404, body: {} }])
    const env = await prepareCosmosVote({
      chain: 'Cosmos',
      voter: COSMOS_ADDR,
      proposalId: '1',
      option: 'no',
      fetchImpl,
    })
    expect(env.accountNumber).toBe('0')
    expect(env.sequence).toBe('0')
  })

  it('parses a nested vesting account', async () => {
    const fetchImpl = mockFetch([
      {
        match: /\/accounts\//,
        body: { account: { base_vesting_account: { base_account: { account_number: '99', sequence: '4' } } } },
      },
    ])
    const env = await prepareCosmosVote({
      chain: 'Cosmos',
      voter: COSMOS_ADDR,
      proposalId: '1',
      option: 'abstain',
      fetchImpl,
    })
    expect(env.accountNumber).toBe('99')
    expect(env.sequence).toBe('4')
  })

  it('fails closed when a populated account cannot be parsed (no sequence=0 default)', async () => {
    const fetchImpl = mockFetch([{ match: /\/accounts\//, body: { account: { some_custom_shape: true } } }])
    await expect(
      prepareCosmosVote({ chain: 'Cosmos', voter: COSMOS_ADDR, proposalId: '1', option: 'yes', fetchImpl })
    ).rejects.toThrow(/could not be parsed/)
  })

  it('rejects a voter address whose HRP mismatches the chain', async () => {
    const fetchImpl = mockFetch([authRoute('1', '0')])
    await expect(
      prepareCosmosVote({ chain: 'Cosmos', voter: OSMO_ADDR, proposalId: '1', option: 'yes', fetchImpl })
    ).rejects.toThrow(/does not match expected "cosmos"/)
  })

  it('rejects a malformed bech32 address', async () => {
    await expect(
      prepareCosmosVote({ chain: 'Cosmos', voter: 'not-an-address', proposalId: '1', option: 'yes' })
    ).rejects.toThrow(/malformed bech32/)
  })

  it('rejects a non-positive proposalId', async () => {
    const fetchImpl = mockFetch([authRoute('1', '0')])
    await expect(
      prepareCosmosVote({ chain: 'Cosmos', voter: COSMOS_ADDR, proposalId: '0', option: 'yes', fetchImpl })
    ).rejects.toThrow(/must be a positive integer/)
  })

  it('attaches optional metadata when provided', async () => {
    const fetchImpl = mockFetch([authRoute('1', '0')])
    const env = await prepareCosmosVote({
      chain: 'Cosmos',
      voter: COSMOS_ADDR,
      proposalId: '1',
      option: 'yes',
      metadata: 'voting yes per validator note',
      fetchImpl,
    })
    expect(env.metadata).toBe('voting yes per validator note')
  })
})
