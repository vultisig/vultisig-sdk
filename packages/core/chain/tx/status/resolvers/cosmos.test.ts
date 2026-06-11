import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCosmosClient: vi.fn(),
  getTx: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/cosmos/client', () => ({
  getCosmosClient: mocks.getCosmosClient,
}))

import { Chain } from '../../../Chain'
import { getCosmosTxStatus } from './cosmos'

describe('getCosmosTxStatus', () => {
  const hash = 'A'.repeat(64)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCosmosClient.mockResolvedValue({
      getTx: mocks.getTx,
    })
  })

  it('returns isKnown:false when the tx client cannot connect', async () => {
    mocks.getCosmosClient.mockRejectedValue(new Error('rpc unavailable'))

    const result = await getCosmosTxStatus({ chain: Chain.Cosmos, hash })
    expect(result).toEqual({ status: 'pending', isKnown: false })
  })

  it('returns isKnown:false when the tx RPC fails', async () => {
    mocks.getTx.mockRejectedValue(new Error('rpc down'))

    const result = await getCosmosTxStatus({ chain: Chain.Cosmos, hash })
    expect(result).toEqual({ status: 'pending', isKnown: false })
  })

  it('returns isKnown:false when the hash is not indexed yet', async () => {
    mocks.getTx.mockResolvedValue(null)

    const result = await getCosmosTxStatus({ chain: Chain.Cosmos, hash })
    expect(result).toEqual({ status: 'pending', isKnown: false })
  })

  it('returns success when the indexed tx succeeded', async () => {
    mocks.getTx.mockResolvedValue({
      code: 0,
      gasUsed: 0n,
    })

    const result = await getCosmosTxStatus({ chain: Chain.Cosmos, hash })
    expect(result).toEqual({ status: 'success' })
  })
})
