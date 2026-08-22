import { describe, expect, it } from 'vitest'

import {
  buildErc20ApprovalTx,
  cosmos,
  encodeErc20Approve,
  evm,
  getCosmosGovernanceProposals,
  prepareCosmosVote,
  resolveContract,
  token,
} from '@/index'
import { cosmos as cosmosFromTools, evm as evmFromTools, token as tokenFromTools } from '@/tools'

describe('SDK root tool namespaces', () => {
  it('exposes the EVM helper family without removing flat exports', () => {
    expect(evm).toBe(evmFromTools)
    expect(evm.encodeErc20Approve).toBe(encodeErc20Approve)
    expect(evm.buildErc20ApprovalTx).toBe(buildErc20ApprovalTx)
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
