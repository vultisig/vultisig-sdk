/**
 * Runnable receipt for sdk.cosmos.gov (proposals read + vote envelope).
 *
 * Exercises the REAL primitives end-to-end against a LIVE Osmosis LCD:
 *   1. getCosmosGovernanceProposals — reads live governance proposals.
 *   2. prepareCosmosVote — builds an UNSIGNED cosmos-sdk/MsgVote envelope
 *      (fetches real account_number/sequence for a funded Osmosis address).
 *
 * NO signing, NO broadcast — this only reads + builds an unsigned envelope.
 *
 * Run:
 *   node --import tsx scripts/receipts/cosmos_gov.mjs
 */
import { getCosmosGovernanceProposals, prepareCosmosVote } from '../../packages/sdk/src/tools/cosmos/gov.ts'

// A well-known, long-lived funded Osmosis address (Osmosis Foundation grants
// multisig — public, never funded by us). Used read-only to fetch real
// account_number/sequence. We never sign on its behalf.
const OSMO_VOTER = 'osmo1cyyzpxplxdzkeea7kwsydadg87357qnahakaks'

async function main() {
  console.log('=== sdk.cosmos.gov receipt — LIVE Osmosis LCD ===\n')

  // 1) Read live governance proposals (most recent, any status).
  const read = await getCosmosGovernanceProposals({ chain: 'Osmosis', status: 'all', limit: 3 })
  console.log(`[read] chain=${read.chain} chainId=${read.chainId} status=${read.status} count=${read.count}`)
  for (const p of read.proposals) {
    console.log(`  #${p.proposalId} [${p.status}] ${p.title.slice(0, 60)}`)
    console.log(`     tally yes=${p.voteTally.yes} no=${p.voteTally.no} abstain=${p.voteTally.abstain}`)
  }

  // 2) Build an UNSIGNED MsgVote envelope for the most recent proposal.
  const proposalId = read.proposals[0]?.proposalId ?? '1'
  const envelope = await prepareCosmosVote({
    chain: 'Osmosis',
    voter: OSMO_VOTER,
    proposalId,
    option: 'yes',
    metadata: 'sdk.cosmos.gov receipt — unsigned, never broadcast',
  })

  console.log('\n[build] unsigned cosmos-sdk/MsgVote envelope:')
  console.log(JSON.stringify(envelope, null, 2))

  // Sanity assertions so the receipt fails loudly if the contract drifts.
  if (envelope.type !== 'cosmos-sdk/MsgVote') throw new Error('bad envelope type')
  if (envelope.voteOption !== 'VOTE_OPTION_YES') throw new Error('bad voteOption mapping')
  if (envelope.chainId !== 'osmosis-1') throw new Error('bad chainId')
  if (!/^\d+$/.test(envelope.accountNumber) || !/^\d+$/.test(envelope.sequence)) {
    throw new Error('account_number/sequence not numeric')
  }

  console.log('\nOK — read live proposals + built an unsigned MsgVote (no signing, no broadcast).')
}

main().catch(err => {
  console.error('RECEIPT FAILED:', err)
  process.exit(1)
})
