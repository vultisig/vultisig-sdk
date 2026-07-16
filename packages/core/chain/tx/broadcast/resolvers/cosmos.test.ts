import { TimeoutError } from '@cosmjs/stargate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCosmosClient: vi.fn(),
  verifyBroadcastByHash: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/cosmos/client', () => ({
  getCosmosClient: mocks.getCosmosClient,
}))

vi.mock('../verifyBroadcastByHash', () => ({
  verifyBroadcastByHash: mocks.verifyBroadcastByHash,
}))

import { CosmosChain } from '../../../Chain'
import { broadcastCosmosTx, getCosmosBroadcastTimeoutTxId } from './cosmos'

const txBytes = Buffer.from([0x0a, 0x01, 0x02])
const tx = {
  serialized: JSON.stringify({
    tx_bytes: txBytes.toString('base64'),
  }),
} as any

describe('broadcastCosmosTx', () => {
  const chain = CosmosChain.Cosmos

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the tx id when CosmJS accepted the tx but timed out waiting for indexing', async () => {
    const timeout = new TimeoutError(
      'Transaction with ID ABC123 was submitted but was not yet found on the chain.',
      'ABC123'
    )
    mocks.getCosmosClient.mockResolvedValue({
      broadcastTx: vi.fn().mockRejectedValue(timeout),
    })

    await expect(broadcastCosmosTx({ chain, tx })).resolves.toBe('ABC123')

    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('keeps duplicate cache errors idempotent', async () => {
    mocks.getCosmosClient.mockResolvedValue({
      broadcastTx: vi.fn().mockRejectedValue(new Error('tx already exists in cache')),
    })

    await expect(broadcastCosmosTx({ chain, tx })).resolves.toBeUndefined()

    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('routes non-timeout errors through hash verification', async () => {
    const error = new Error('account sequence mismatch')
    mocks.getCosmosClient.mockResolvedValue({
      broadcastTx: vi.fn().mockRejectedValue(error),
    })
    mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

    await expect(broadcastCosmosTx({ chain, tx })).resolves.toBeUndefined()

    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledWith({
      chain,
      tx,
      error,
    })
  })

  it('extracts only non-empty tx ids from CosmJS timeout errors', () => {
    expect(getCosmosBroadcastTimeoutTxId(new TimeoutError('pending', 'ABC123'))).toBe('ABC123')
    expect(getCosmosBroadcastTimeoutTxId(new TimeoutError('pending', '   '))).toBeUndefined()
    expect(getCosmosBroadcastTimeoutTxId(new Error('pending'))).toBeUndefined()
  })
})
