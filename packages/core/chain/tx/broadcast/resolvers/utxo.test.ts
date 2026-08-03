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

  it('routes an "already known" duplicate through hash verification instead of blanket-swallowing it (false-success fix)', async () => {
    // Before the fix, 'txn-mempool-conflict'/'already known'/'BadInputsUTxO' were bucketed together and
    // returned null unconditionally — but BadInputsUTxO is a GENUINE failure (spent/invalid inputs), not
    // an MPC-race duplicate. Verification is now mandatory for every ambiguous submit error.
    mocks.queryUrl.mockResolvedValue({
      data: null,
      context: { error: 'txn-mempool-conflict' },
    })
    mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

    await expect(broadcastUtxoTx({ chain, tx })).resolves.toBeNull()

    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledTimes(1)
  })

  it('rejects a BadInputsUTxO error when the tx is NOT actually on chain (the false-success bug this fixes)', async () => {
    const verifyError = new Error('Failed to broadcast transaction: BadInputsUTxO')
    mocks.queryUrl.mockResolvedValue({
      data: null,
      context: { error: 'BadInputsUTxO' },
    })
    // verifyBroadcastByHash rethrows the original error when the tx isn't confirmed on-chain — see its
    // own contract in verifyBroadcastByHash.ts.
    mocks.verifyBroadcastByHash.mockRejectedValue(verifyError)

    await expect(broadcastUtxoTx({ chain, tx })).rejects.toBe(verifyError)
  })

  it('still succeeds on a genuine MPC-race "already known" when hash verification confirms the tx IS on chain', async () => {
    mocks.queryUrl.mockResolvedValue({
      data: null,
      context: { error: 'already known' },
    })
    mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

    await expect(broadcastUtxoTx({ chain, tx })).resolves.toBeNull()

    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledTimes(1)
  })
})
