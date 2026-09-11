import { describe, expect, it } from 'vitest'

import {
  balance,
  buildCw20TransferMsg,
  computeAstroportMinReceive,
  cosmos,
  encodeErc20Approve,
  evm,
  getCosmosGovernanceProposals,
  getSolBalance,
  prep,
  prepareCosmosVote,
  resolveContract,
  swap,
  token,
} from '@/index'
import { cosmos as cosmosFromTools, evm as evmFromTools, token as tokenFromTools } from '@/tools'

describe('SDK root tool namespaces', () => {
  it('exposes the complete balance, prep and swap families alongside flat exports', async () => {
    const tools = await import('@/tools')
    const canonicalBalance = await import('@/tools/balance')
    const canonicalPrep = await import('@/tools/prep')
    const canonicalSwap = await import('@/tools/swap')
    expect(balance).toBe(tools.balance)
    expect(prep).toBe(tools.prep)
    expect(swap).toBe(tools.swap)
    expect(balance).toEqual(canonicalBalance)
    expect(prep).toEqual(canonicalPrep)
    expect(swap).toEqual(canonicalSwap)
    expect(balance.getSolBalance).toBe(getSolBalance)
    expect(prep.buildCw20TransferMsg).toBe(buildCw20TransferMsg)
    expect(swap.computeAstroportMinReceive).toBe(computeAstroportMinReceive)
    expect(balance.formatBalance(1500000n, 6)).toBe('1.5')
    expect(swap.computeAstroportMinReceive('1000000', 0.01)).toBe('990000')
  })

  it('exposes the EVM helper family without removing flat exports', () => {
    expect(evm).toBe(evmFromTools)
    expect(evm.encodeErc20Approve).toBe(encodeErc20Approve)
  })

  it('exposes the token helper family without removing flat exports', () => {
    expect(token).toBe(tokenFromTools)
    expect(token.resolveContract).toBe(resolveContract)
  })

  it('exposes Cosmos governance under sdk.cosmos.gov without removing flat exports', () => {
    expect(cosmos).toBe(cosmosFromTools)
    expect(cosmos.gov.getCosmosGovernanceProposals).toBe(getCosmosGovernanceProposals)
    expect(cosmos.gov.prepareCosmosVote).toBe(prepareCosmosVote)
  })
})
