import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCardanoTxHash: vi.fn(),
  submitCardanoCbor: vi.fn(),
  verifyBroadcastByHash: vi.fn(),
}))

vi.mock('../../../chains/cardano/submit/submitCardanoCbor', () => ({
  submitCardanoCbor: mocks.submitCardanoCbor,
}))

vi.mock('@vultisig/core-chain/tx/hash/resolvers/cardano', () => ({
  getCardanoTxHash: mocks.getCardanoTxHash,
}))

vi.mock('../verifyBroadcastByHash', () => ({
  verifyBroadcastByHash: mocks.verifyBroadcastByHash,
}))

import { OtherChain } from '../../../Chain'
import { broadcastCardanoTx } from './cardano'

describe('broadcastCardanoTx', () => {
  const chain = OtherChain.Cardano
  const tx = { encoded: new Uint8Array([0x84, 0xa0, 0xa0, 0xf5]) } as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes timeout responses through verifyBroadcastByHash before swallowing', async () => {
    mocks.submitCardanoCbor.mockResolvedValue({ errorMessage: 'request timed out' })
    mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

    await expect(broadcastCardanoTx({ chain, tx })).resolves.toBeNull()

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
    mocks.submitCardanoCbor.mockResolvedValue({ errorMessage: 'request timed out' })
    mocks.verifyBroadcastByHash.mockRejectedValue(verifyError)

    await expect(broadcastCardanoTx({ chain, tx })).rejects.toBe(verifyError)
  })

  it('continues swallowing duplicate Cardano broadcast errors without hash verification', async () => {
    mocks.submitCardanoCbor.mockResolvedValue({ errorMessage: 'txn-mempool-conflict' })

    await expect(broadcastCardanoTx({ chain, tx })).resolves.toBeNull()

    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })
})
