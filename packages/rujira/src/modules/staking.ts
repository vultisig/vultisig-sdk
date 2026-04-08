/**
 * Staking module for RUJI token staking on THORChain
 * @module modules/staking
 */

import type { Coin } from '@cosmjs/proto-signing'

import type { RujiraClient } from '../client.js'
import { RujiraError, RujiraErrorCode, wrapError } from '../errors.js'
import { base64Encode } from '../utils/encoding.js'
import { fromBaseUnits } from '../utils/format.js'
import { validateThorAddress } from '../validation/address-validator.js'

// Constants

const STAKING_CONTRACT = 'thor13g83nn5ef4qzqeafp0508dnvkvm0zqr3sj7eefcn5umu65gqluusrml5cr'
const STAKING_GRAPHQL_URL = 'https://api.vultisig.com/ruji/api/graphql'
const BOND_DENOM = 'x/ruji'
const BOND_DECIMALS = 8
const REVENUE_DECIMALS = 6

// Types

export type StakingPosition = {
  /** Bonded RUJI amount in base units (8 decimals) */
  bonded: string
  /** Human-readable bonded amount */
  bondedFormatted: string
  /** Bond asset ticker */
  bondTicker: string
  /** Pending USDC rewards in base units (6 decimals) */
  rewards: string
  /** Human-readable rewards amount */
  rewardsFormatted: string
  /** Rewards asset ticker */
  rewardsTicker: string
  /** Annual percentage rate as decimal (0.15 = 15%) */
  apr: number
  /** APR as percentage string (e.g. "15.00") */
  aprPercent: string
}

export type StakeParams = {
  /** Amount of RUJI to stake in base units (8 decimals) */
  amount: string
}

export type UnstakeParams = {
  /** Amount of RUJI to unstake in base units (8 decimals) */
  amount: string
}

export type StakeTransactionParams = {
  contractAddress: string
  executeMsg: object
  funds: Coin[]
}

// GraphQL types

type StakingV2Response = {
  node?: {
    stakingV2?: Array<{
      bonded: { amount: string; asset?: { metadata?: { symbol?: string } } }
      pendingRevenue?: { amount: string; asset?: { metadata?: { symbol?: string } } }
      pool?: { summary?: { apr?: { value?: string } } }
    }>
  }
}

const STAKING_QUERY = `
  query ($id: ID!) {
    node(id: $id) {
      ... on Account {
        stakingV2 {
          bonded { amount asset { metadata { symbol } } }
          pendingRevenue { amount asset { metadata { symbol } } }
          pool { summary { apr { value } } }
        }
      }
    }
  }
`

/**
 * RUJI staking module.
 *
 * @example
 * ```typescript
 * const client = new RujiraClient();
 * await client.connect();
 *
 * // Query staking position
 * const position = await client.staking.getPosition('thor1...');
 * console.log(`Staked: ${position.bondedFormatted} RUJI`);
 * console.log(`Rewards: ${position.rewardsFormatted} USDC`);
 *
 * // Build stake transaction params (for external signing)
 * const tx = client.staking.buildStake({ amount: '100000000' });
 * ```
 */
export class RujiraStaking {
  private readonly client: RujiraClient

  constructor(client: RujiraClient) {
    this.client = client
  }

  /**
   * Get staking position for a THORChain address.
   * Queries the Rujira GraphQL API for bonded amount, pending rewards, and APR.
   */
  async getPosition(address: string): Promise<StakingPosition | null> {
    validateThorAddress(address)

    try {
      const nodeId = base64Encode(`Account:${address}`)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)
      const response = await fetch(STAKING_GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: STAKING_QUERY, variables: { id: nodeId } }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout))

      if (!response.ok) {
        throw new RujiraError(RujiraErrorCode.NETWORK_ERROR, `GraphQL request failed: ${response.status}`)
      }

      const json = (await response.json()) as { data: StakingV2Response; errors?: Array<{ message: string }> }
      if (json.errors?.length) {
        throw new RujiraError(RujiraErrorCode.NETWORK_ERROR, `GraphQL errors: ${json.errors[0].message}`)
      }
      const stakingData = json.data?.node?.stakingV2?.[0]

      if (!stakingData) {
        return null
      }

      const bonded = stakingData.bonded.amount || '0'
      const rewards = stakingData.pendingRevenue?.amount || '0'
      const aprValue = stakingData.pool?.summary?.apr?.value

      return {
        bonded,
        bondedFormatted: fromBaseUnits(bonded, BOND_DECIMALS),
        bondTicker: stakingData.bonded.asset?.metadata?.symbol || 'RUJI',
        rewards,
        rewardsFormatted: fromBaseUnits(rewards, REVENUE_DECIMALS),
        rewardsTicker: stakingData.pendingRevenue?.asset?.metadata?.symbol || 'USDC',
        apr: aprValue && !Number.isNaN(parseFloat(aprValue)) ? parseFloat(aprValue) : 0,
        aprPercent: aprValue && !Number.isNaN(parseFloat(aprValue)) ? (parseFloat(aprValue) * 100).toFixed(2) : '0.00',
      }
    } catch (error) {
      throw wrapError(error)
    }
  }

  /**
   * Build stake (bond) transaction parameters.
   * Returns the contract address, execute message, and funds needed for signing.
   */
  buildStake(params: StakeParams): StakeTransactionParams {
    if (!params.amount || BigInt(params.amount) <= 0n) {
      throw new RujiraError(RujiraErrorCode.INVALID_AMOUNT, 'Stake amount must be positive')
    }

    return {
      contractAddress: STAKING_CONTRACT,
      executeMsg: { account: { bond: {} } },
      funds: [{ denom: BOND_DENOM, amount: params.amount }],
    }
  }

  /**
   * Build unstake (withdraw) transaction parameters.
   */
  buildUnstake(params: UnstakeParams): StakeTransactionParams {
    if (!params.amount || BigInt(params.amount) <= 0n) {
      throw new RujiraError(RujiraErrorCode.INVALID_AMOUNT, 'Unstake amount must be positive')
    }

    return {
      contractAddress: STAKING_CONTRACT,
      executeMsg: { account: { withdraw: { amount: params.amount } } },
      funds: [],
    }
  }

  /**
   * Build claim rewards transaction parameters.
   */
  buildClaimRewards(): StakeTransactionParams {
    return {
      contractAddress: STAKING_CONTRACT,
      executeMsg: { account: { claim: {} } },
      funds: [],
    }
  }

  /** Staking contract address */
  get contractAddress(): string {
    return STAKING_CONTRACT
  }

  /** Bond denom (x/ruji) */
  get bondDenom(): string {
    return BOND_DENOM
  }
}
