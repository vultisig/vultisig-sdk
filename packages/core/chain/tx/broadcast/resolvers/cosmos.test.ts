import { TimeoutError } from '@cosmjs/stargate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  broadcastTx: vi.fn(),
  verifyBroadcastByHash: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/cosmos/client', () => ({
  getCosmosClient: () => ({
    broadcastTx: mocks.broadcastTx,
  }),
}))

vi.mock('../verifyBroadcastByHash', () => ({
  verifyBroadcastByHash: mocks.verifyBroadcastByHash,
}))

import { CosmosChain } from '../../../Chain'
import { broadcastCosmosTx, getCosmosBroadcastTimeoutTxId } from './cosmos'

describe('broadcastCosmosTx', () => {
  const chain = CosmosChain.THORChain
  const tx = {
    serialized: JSON.stringify({ tx_bytes: Buffer.from([0x01, 0x02, 0x03]).toString('base64') }),
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports success when the tx is included and DeliverTx code is 0', async () => {
    mocks.broadcastTx.mockResolvedValue({
      code: 0,
      transactionHash: 'ABC123',
      height: 100,
      rawLog: '',
    })

    await expect(broadcastCosmosTx({ chain, tx })).resolves.toBeUndefined()

    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  // The false-success bug: cosmjs StargateClient.broadcastTx RESOLVES (does not
  // throw) once the tx lands in a block, even when execution itself failed
  // (out-of-gas, wasm revert, a THORChain/Maya deposit-handler rejection). Before
  // the fix, only `error` was inspected, so a resolved DeliverTx with code !== 0
  // fell through to `if (!error) return` and was reported as a broadcast success
  // with a real, but execution-failed, on-chain hash.
  it('reports failure when the tx is included but DeliverTx code is non-zero (false-success fix)', async () => {
    mocks.broadcastTx.mockResolvedValue({
      code: 5,
      transactionHash: 'DEF456',
      height: 100,
      rawLog: 'out of gas',
    })

    await expect(broadcastCosmosTx({ chain, tx })).rejects.toThrow(/DEF456/)
    await expect(broadcastCosmosTx({ chain, tx })).rejects.toThrow(/out of gas/)

    // The response already proves the tx's on-chain outcome — no need to pay
    // for a redundant hash-verification round trip.
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('treats a duplicate in-cache rejection as an idempotent success', async () => {
    mocks.broadcastTx.mockRejectedValue(new Error('tx already exists in cache'))

    await expect(broadcastCosmosTx({ chain, tx })).resolves.toBeUndefined()

    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('returns the tx id when CosmJS accepted the tx but timed out waiting for indexing', async () => {
    const timeout = new TimeoutError(
      'Transaction with ID ABC123 was submitted but was not yet found on the chain.',
      'ABC123'
    )
    mocks.broadcastTx.mockRejectedValue(timeout)

    await expect(broadcastCosmosTx({ chain, tx })).resolves.toBe('ABC123')

    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('routes other broadcast errors through hash verification', async () => {
    const rpcError = new Error('request timed out')
    mocks.broadcastTx.mockRejectedValue(rpcError)
    mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

    await expect(broadcastCosmosTx({ chain, tx })).resolves.toBeUndefined()

    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledWith({ chain, tx, error: rpcError })
  })

  it('extracts only non-empty tx ids from CosmJS timeout errors', () => {
    expect(getCosmosBroadcastTimeoutTxId(new TimeoutError('pending', 'ABC123'))).toBe('ABC123')
    expect(getCosmosBroadcastTimeoutTxId(new TimeoutError('pending', '   '))).toBeUndefined()
    expect(getCosmosBroadcastTimeoutTxId(new Error('pending'))).toBeUndefined()
  })
})
