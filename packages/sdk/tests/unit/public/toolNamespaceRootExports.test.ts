import { describe, expect, it } from 'vitest'

import {
  bridge,
  cosmos,
  encodeErc20Approve,
  evm,
  gas,
  getCosmosGasLimit,
  getCosmosGovernanceProposals,
  getCctpChain,
  prepareCosmosVote,
  resolveContract,
  token,
} from '@/index'
import { bridge as bridgeFromTools, cosmos as cosmosFromTools, evm as evmFromTools, gas as gasFromTools, token as tokenFromTools } from '@/tools'

describe('SDK root tool namespaces', () => {
  it('exposes the EVM helper family without removing flat exports', () => {
    expect(evm).toBe(evmFromTools)
    expect(evm.encodeErc20Approve).toBe(encodeErc20Approve)
  })

  it('exposes the token helper family without removing flat exports', () => {
    expect(token).toBe(tokenFromTools)
    expect(token.resolveContract).toBe(resolveContract)
  })

  it('exposes the bridge helper family without removing flat exports', () => {
    expect(bridge).toBe(bridgeFromTools)
    expect(bridge.getCctpChain).toBe(getCctpChain)
  })

  it('exposes Cosmos governance under sdk.cosmos.gov without removing flat exports', () => {
    expect(cosmos).toBe(cosmosFromTools)
    expect(cosmos.gov.getCosmosGovernanceProposals).toBe(getCosmosGovernanceProposals)
    expect(cosmos.gov.prepareCosmosVote).toBe(prepareCosmosVote)
  })

  it('exposes gas helpers under sdk.gas.cosmos without removing flat exports', () => {
    expect(gas).toBe(gasFromTools)
    expect(gas.cosmos.getCosmosGasLimit).toBe(getCosmosGasLimit)
  })
})
