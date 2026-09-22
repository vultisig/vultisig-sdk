import { describe, expect, it } from 'vitest'

import * as sdk from '@/index'
import {
  balance,
  bridge,
  buildCctpBridge,
  buildCw20TransferMsg,
  computeAstroportMinReceive,
  cosmos,
  encodeErc20Approve,
  estimateCosmosSwapFeeLabel,
  evm,
  gas,
  getCctpChain,
  getCosmosGasLimit,
  getCosmosGovernanceProposals,
  getSolBalance,
  prep,
  prepareCosmosVote,
  resolveContract,
  swap,
  token,
} from '@/index'
import {
  bridge as bridgeFromTools,
  cosmos as cosmosFromTools,
  evm as evmFromTools,
  gas as gasFromTools,
  price as priceFromTools,
  token as tokenFromTools,
} from '@/tools'
import * as bridgeHelpers from '@/tools/bridge'
import * as gasHelpers from '@/tools/gas'
import * as cosmosGasHelpers from '@/tools/gas/cosmos'
import * as priceHelpers from '@/tools/price'

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

  it('exposes the complete price family through the same tools namespace and preserves flat exports', () => {
    expect(sdk.price).toBe(priceFromTools)
    expect(Object.keys(sdk.price).sort()).toEqual(Object.keys(priceHelpers).sort())
    for (const name of Object.keys(priceHelpers) as (keyof typeof priceHelpers)[]) {
      expect(sdk.price[name]).toBe(priceHelpers[name])
      expect(sdk.price[name]).toBe(sdk[name])
    }
  })

  it('exposes the canonical bridge family alongside flat helpers', () => {
    expect(bridge).toBe(bridgeFromTools)
    expect(Object.keys(bridge).sort()).toEqual(Object.keys(bridgeHelpers).sort())
    for (const name of Object.keys(bridgeHelpers) as (keyof typeof bridgeHelpers)[]) {
      expect(bridge[name]).toBe(bridgeHelpers[name])
    }
    expect(bridge.getCctpChain).toBe(getCctpChain)
    expect(bridge.buildCctpBridge).toBe(buildCctpBridge)
    expect(bridge.getCctpChain('Base')?.evmChainId).toBe(8453)
    expect(
      bridge.buildCctpBridge({
        sourceChain: 'Base',
        destinationChain: 'Arbitrum',
        amount: '10',
        from: '0x1111111111111111111111111111111111111111',
      }).transactions
    ).toHaveLength(2)
  })

  it('exposes canonical Cosmos gas helpers under gas while preserving flat helpers', () => {
    expect(gas).toBe(gasFromTools)
    expect(Object.keys(gas).sort()).toEqual(Object.keys(gasHelpers).sort())
    expect(gas.cosmos).toBe(gasHelpers.cosmos)
    expect(Object.keys(gas.cosmos).sort()).toEqual(Object.keys(cosmosGasHelpers).sort())
    for (const name of Object.keys(cosmosGasHelpers) as (keyof typeof cosmosGasHelpers)[]) {
      expect(gas.cosmos[name]).toBe(cosmosGasHelpers[name])
    }
    expect(gas.cosmos.getCosmosGasLimit).toBe(getCosmosGasLimit)
    expect(gas.cosmos.estimateCosmosSwapFeeLabel).toBe(estimateCosmosSwapFeeLabel)
    expect(gas.cosmos.estimateCosmosSwapFeeLabel('Cosmos')).toBe(estimateCosmosSwapFeeLabel('Cosmos'))
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
