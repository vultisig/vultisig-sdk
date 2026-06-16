import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryUrl: vi.fn(),
  verifyBroadcastByHash: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

vi.mock('../verifyBroadcastByHash', () => ({
  verifyBroadcastByHash: mocks.verifyBroadcastByHash,
}))

import { UtxoChain } from '../../../Chain'
import { broadcastUtxoTx } from './utxo'

describe('broadcastUtxoTx', () => {
  const chain = UtxoChain.Bitcoin
  const tx = { encoded: new Uint8Array([0x01, 0x02, 0x03]) } as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes timeout responses through verifyBroadcastByHash before swallowing', async () => {
    mocks.queryUrl.mockResolvedValue({
      data: null,
      context: { error: 'request timed out' },
    })
    mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

    await expect(broadcastUtxoTx({ chain, tx })).resolves.toBeNull()

    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledTimes(1)
    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledWith({
      chain,
      tx,
      error: expect.objectContaining({
        message: 'Failed to broadcast transaction: request timed out',
      }),
    })
  })

  it('propagates timeout responses when hash verification cannot find the transaction', async () => {
    const verifyError = new Error('verified missing tx')
    mocks.queryUrl.mockResolvedValue({
      data: null,
      context: { error: 'request timed out' },
    })
    mocks.verifyBroadcastByHash.mockRejectedValue(verifyError)

    await expect(broadcastUtxoTx({ chain, tx })).rejects.toBe(verifyError)
  })

  it('continues swallowing duplicate UTXO broadcast errors without hash verification', async () => {
    mocks.queryUrl.mockResolvedValue({
      data: null,
      context: { error: 'txn-mempool-conflict' },
    })

    await expect(broadcastUtxoTx({ chain, tx })).resolves.toBeNull()

    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })
})
