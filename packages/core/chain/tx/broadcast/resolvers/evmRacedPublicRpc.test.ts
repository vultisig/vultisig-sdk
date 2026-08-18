import { EvmChain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQueryUrl } = vi.hoisted(() => ({
  mockQueryUrl: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mockQueryUrl,
}))

import {
  broadcastEvmTxRacedPublicRpc,
  evmRacedPublicBroadcastRpcs,
  hasEvmRacedPublicBroadcastRpcs,
} from './evmRacedPublicRpc'

const RAW = '0x02f8deadbeef'

describe('evm raced-public-rpc broadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is configured for Ethereum and not for other EVM chains', () => {
    expect(hasEvmRacedPublicBroadcastRpcs(EvmChain.Ethereum)).toBe(true)
    expect(hasEvmRacedPublicBroadcastRpcs(EvmChain.Base)).toBe(false)
    expect(hasEvmRacedPublicBroadcastRpcs(EvmChain.Arbitrum)).toBe(false)
  })

  it('returns on the first public-RPC success and still fires the rest', async () => {
    mockQueryUrl.mockImplementation(async (url: string) => {
      if (url === evmRacedPublicBroadcastRpcs[EvmChain.Ethereum]![0]) {
        return { result: '0xabc' }
      }
      return { error: { message: 'timeout' } }
    })

    await expect(broadcastEvmTxRacedPublicRpc(EvmChain.Ethereum, RAW)).resolves.toBeUndefined()
    expect(mockQueryUrl).toHaveBeenCalled()
  })

  it('treats already-known as success so a sibling race does not fail the broadcast', async () => {
    mockQueryUrl.mockResolvedValue({ error: { message: 'already known' } })

    await expect(broadcastEvmTxRacedPublicRpc(EvmChain.Ethereum, RAW)).resolves.toBeUndefined()
  })

  it('throws when every public endpoint rejects (does not fall back to the proxy)', async () => {
    mockQueryUrl.mockResolvedValue({ error: { message: 'nonce too low' } })

    await expect(broadcastEvmTxRacedPublicRpc(EvmChain.Ethereum, RAW)).rejects.toThrow(
      /raced-public-rpc broadcast failed for Ethereum/
    )
  })

  it('throws for a chain with no public endpoints configured', async () => {
    await expect(broadcastEvmTxRacedPublicRpc(EvmChain.Base, RAW)).rejects.toThrow(
      /not configured for Base/
    )
    expect(mockQueryUrl).not.toHaveBeenCalled()
  })
})
