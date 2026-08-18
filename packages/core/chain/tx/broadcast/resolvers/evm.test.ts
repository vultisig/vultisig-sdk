import { EvmChain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSendRaw, mockRaced, mockVerify } = vi.hoisted(() => ({
  mockSendRaw: vi.fn(),
  mockRaced: vi.fn(),
  mockVerify: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({
    sendRawTransaction: mockSendRaw,
  }),
}))

vi.mock('./evmRacedPublicRpc', () => ({
  broadcastEvmTxRacedPublicRpc: mockRaced,
}))

vi.mock('../verifyBroadcastByHash', () => ({
  verifyBroadcastByHash: mockVerify,
}))

import { broadcastEvmTx } from './evm'

const tx = { encoded: new Uint8Array([0x02, 0xaa]) } as never

describe('broadcastEvmTx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the single-endpoint client by default', async () => {
    mockSendRaw.mockResolvedValue('0xhash')

    await broadcastEvmTx({ chain: EvmChain.Ethereum, tx })

    expect(mockSendRaw).toHaveBeenCalledOnce()
    expect(mockRaced).not.toHaveBeenCalled()
  })

  it('routes raced-public-rpc to the public-RPC racer and skips the proxy client', async () => {
    mockRaced.mockResolvedValue(undefined)

    await broadcastEvmTx({ chain: EvmChain.Ethereum, tx, strategy: 'raced-public-rpc' })

    expect(mockRaced).toHaveBeenCalledOnce()
    expect(mockSendRaw).not.toHaveBeenCalled()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('does not swallow a raced-public-rpc failure into the default proxy path', async () => {
    mockRaced.mockRejectedValue(new Error('raced-public-rpc broadcast failed for Ethereum'))

    await expect(broadcastEvmTx({ chain: EvmChain.Ethereum, tx, strategy: 'raced-public-rpc' })).rejects.toThrow(
      /raced-public-rpc broadcast failed/
    )
    expect(mockSendRaw).not.toHaveBeenCalled()
  })
})
