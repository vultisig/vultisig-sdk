import { describe, expect, it } from 'vitest'

import {
  cosmos,
  encodeErc20Approve,
  evm,
  getCosmosGovernanceProposals,
  getPrice,
  prepareCosmosVote,
  price,
  resolveContract,
  token,
} from '@/index'
import {
  cosmos as cosmosFromTools,
  evm as evmFromTools,
  price as priceFromTools,
  token as tokenFromTools,
} from '@/tools'

describe('SDK root tool namespaces', () => {
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

  it('exposes the price helper family under sdk.price without removing flat exports (sdk#1780)', () => {
    expect(price).toBe(priceFromTools)
    expect(price.getPrice).toBe(getPrice)
  })
})
