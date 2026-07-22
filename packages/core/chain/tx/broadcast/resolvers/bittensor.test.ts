import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryUrl: vi.fn(),
  verifyBroadcastByHash: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: mocks.queryUrl }))
vi.mock('../verifyBroadcastByHash', () => ({ verifyBroadcastByHash: mocks.verifyBroadcastByHash }))
vi.mock('@vultisig/core-chain/chains/bittensor/client', () => ({ bittensorRpcUrl: 'https://bittensor.test' }))

import { OtherChain } from '../../../Chain'
import { isTransientBroadcastError } from '../transientRetry'
import { broadcastBittensorTx } from './bittensor'

describe('broadcastBittensorTx', () => {
  const tx = { encoded: new Uint8Array([0x84, 0x00, 0x01]) } as never
  const chain = OtherChain.Bittensor

  beforeEach(() => vi.clearAllMocks())

  it('returns silently when the node accepts the extrinsic', async () => {
    mocks.queryUrl.mockResolvedValue({ result: '0xdeadbeef' })

    await expect(broadcastBittensorTx({ chain, tx })).resolves.toBeUndefined()
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('accepts case-variant duplicate import errors', async () => {
    mocks.queryUrl.mockResolvedValue({
      error: { code: 1013, message: 'TRANSACTION ALREADY IMPORTED' },
    })

    await expect(broadcastBittensorTx({ chain, tx })).resolves.toBeUndefined()
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('recognizes an idempotent signal carried in error data', async () => {
    mocks.queryUrl.mockResolvedValue({
      error: { code: 1010, message: 'Invalid Transaction', data: 'Already known' },
    })

    await expect(broadcastBittensorTx({ chain, tx })).resolves.toBeUndefined()
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('hash-verifies ambiguous temporarily-banned responses', async () => {
    mocks.queryUrl.mockResolvedValue({
      error: { code: 1010, message: 'Transaction is temporarily banned' },
    })
    mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

    await broadcastBittensorTx({ chain, tx })

    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledOnce()
    expect((mocks.verifyBroadcastByHash.mock.calls[0]![0].error as Error).message).toBe(
      'Bittensor broadcast failed: Transaction is temporarily banned'
    )
  })

  it('preserves error data when routing a genuine rejection through verification', async () => {
    mocks.queryUrl.mockResolvedValue({
      error: {
        code: 1010,
        message: 'Invalid Transaction',
        data: 'Transaction has a bad signature',
      },
    })
    mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

    await broadcastBittensorTx({ chain, tx })

    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledOnce()
    expect((mocks.verifyBroadcastByHash.mock.calls[0]![0].error as Error).message).toBe(
      'Bittensor broadcast failed: Invalid Transaction: Transaction has a bad signature'
    )
  })

  it('routes a response without a result or error through verification', async () => {
    mocks.queryUrl.mockResolvedValue({})
    mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

    await broadcastBittensorTx({ chain, tx })

    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledOnce()
    expect((mocks.verifyBroadcastByHash.mock.calls[0]![0].error as Error).message).toContain('missing extrinsic hash')
  })

  it('surfaces an unconfirmed malformed response as non-transient', async () => {
    mocks.queryUrl.mockResolvedValue({})
    mocks.verifyBroadcastByHash.mockImplementation(async ({ error }) => {
      throw error
    })

    const error = await broadcastBittensorTx({ chain, tx }).catch(caught => caught)

    expect(error).toBeInstanceOf(Error)
    expect(error).toHaveProperty('message', 'Bittensor broadcast failed: missing extrinsic hash in RPC response')
    expect(isTransientBroadcastError(error)).toBe(false)
  })

  it('routes transport failures through verification', async () => {
    const error = new Error('ECONNRESET')
    mocks.queryUrl.mockRejectedValue(error)
    mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

    await broadcastBittensorTx({ chain, tx })

    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledOnce()
    expect(mocks.verifyBroadcastByHash.mock.calls[0]![0].error).toBe(error)
  })
})
