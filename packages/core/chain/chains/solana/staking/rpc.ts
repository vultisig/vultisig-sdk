import { PublicKey } from '@solana/web3.js'

import { getSolanaClient } from '../client'
import { solanaStakingConfig } from './config'
import { parseStakeAccount, SolanaStakeAccount } from './models/stakeAccount'
import { SolanaValidator } from './models/validator'

/**
 * Read-side Solana RPC for native staking. Thin wrappers over the shared
 * `@solana/web3.js` connection (`getSolanaClient`) so the staking read layer
 * stays one call away from the rest of the Solana chain code.
 *
 * Port of the Solana staking reads in iOS `SolanaService` / `SolanaAPI`.
 */

/**
 * Lists every validator from `getVoteAccounts`, tagging each with the
 * delinquent flag derived from its bucket (`current` vs `delinquent`). The base
 * metadata is left empty — the metadata-provider seam enriches it later.
 */
export const fetchSolanaValidators = async (): Promise<SolanaValidator[]> => {
  const client = getSolanaClient()
  const { current, delinquent } = await client.getVoteAccounts()

  const toValidator = (account: (typeof current)[number], isDelinquent: boolean): SolanaValidator => ({
    votePubkey: account.votePubkey,
    nodePubkey: account.nodePubkey,
    // `activatedStake` arrives from the RPC as a JSON number — keep it as-is
    // rather than minting a falsely-exact bigint from an already-lossy value.
    activatedStake: account.activatedStake,
    commission: account.commission,
    epochVoteAccount: account.epochVoteAccount,
    isDelinquent,
    metadata: {},
  })

  return [...current.map(a => toValidator(a, false)), ...delinquent.map(a => toValidator(a, true))]
}

/**
 * Fetches the owner's stake accounts via a Stake-program `getProgramAccounts`
 * scan filtered on `dataSize: 200` (fully-initialized stake accounts) and a
 * memcmp on the staker authority at offset 12. Uncached at the call site — the
 * staking view must reflect just-submitted txs and newly accrued rewards.
 */
export const fetchSolanaStakeAccounts = async (owner: string): Promise<SolanaStakeAccount[]> => {
  const client = getSolanaClient()
  const rows = await client.getParsedProgramAccounts(new PublicKey(solanaStakingConfig.stakeProgramId), {
    filters: [
      { dataSize: solanaStakingConfig.stakeStateSize },
      { memcmp: { offset: solanaStakingConfig.stakerMemcmpOffset, bytes: owner } },
    ],
  })

  return rows.flatMap(({ pubkey, account }) => {
    const { data } = account
    if (!('parsed' in data)) {
      return []
    }
    const parsed = parseStakeAccount({
      pubkey: pubkey.toBase58(),
      lamports: BigInt(account.lamports),
      parsedInfo: data.parsed?.info,
    })
    return parsed ? [parsed] : []
  })
}

/**
 * Fetches a single stake account's parsed state by address. Used by the
 * unstake / withdraw / move flows that operate on a known account.
 */
export const fetchSolanaStakeAccount = async (pubkey: string): Promise<SolanaStakeAccount | undefined> => {
  const client = getSolanaClient()
  const { value } = await client.getParsedAccountInfo(new PublicKey(pubkey))
  if (!value || !('parsed' in value.data)) {
    return undefined
  }
  return parseStakeAccount({
    pubkey,
    lamports: BigInt(value.lamports),
    parsedInfo: value.data.parsed?.info,
  })
}

export type SolanaEpochInfo = {
  epoch: bigint
  slotIndex: bigint
  slotsInEpoch: bigint
}

/** Current epoch info — drives activation-state derivation and cooldown copy. */
export const fetchSolanaEpochInfo = async (): Promise<SolanaEpochInfo> => {
  const client = getSolanaClient()
  const info = await client.getEpochInfo()
  return {
    epoch: BigInt(info.epoch),
    slotIndex: BigInt(info.slotIndex),
    slotsInEpoch: BigInt(info.slotsInEpoch),
  }
}

/**
 * The rent-exempt reserve for a 200-byte stake account, in lamports. The new
 * stake account must be funded with this on top of the delegated amount.
 */
export const fetchSolanaRentReserve = async (): Promise<bigint> => {
  const client = getSolanaClient()
  const lamports = await client.getMinimumBalanceForRentExemption(solanaStakingConfig.stakeStateSize)
  return BigInt(lamports)
}

/** Network inflation rate (total) — drives the on-chain APY fallback. */
export const fetchSolanaInflationRate = async (): Promise<number> => {
  const client = getSolanaClient()
  const { total } = await client.getInflationRate()
  return total
}

/**
 * Total SOL supply in lamports — the denominator for the staked fraction in the
 * APY fallback. `getSupply` returns a JSON number that exceeds 2^53, so it is
 * already approximate; kept as `number` (the ratio it feeds only needs ~2dp),
 * not minted into a falsely-exact bigint.
 */
export const fetchSolanaTotalSupply = async (): Promise<number> => {
  const client = getSolanaClient()
  const { value } = await client.getSupply()
  return value.total
}
