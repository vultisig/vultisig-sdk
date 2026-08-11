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

vi.mock('./verifyBroadcastByHash', () => ({
  verifyBroadcastByHash: mocks.verifyBroadcastByHash,
}))

import { CosmosChain } from '../../Chain'
import { broadcastTx } from '.'
import { DeliverTxFailedError } from './transientRetry'

// Regression coverage for the retry-wrapper interlock: cosmos has no
// resolver-owned retry (`hasResolverOwnedRetry` in `index.ts` exempts only
// evm/solana), so `broadcastCosmosTx`'s DeliverTx-failure throw runs INSIDE
// `withTransientBroadcastRetry`. Unlike `resolvers/cosmos.test.ts`, this
// drives the dispatcher exported from `.` — the wrapper the SDK actually
// calls — so the real retry loop and `isTransientBroadcastError`
// classification both run, not just the resolver in isolation.
describe('broadcastTx cosmos DeliverTx-failure retry interlock', () => {
  const chain = CosmosChain.THORChain
  const tx = {
    serialized: JSON.stringify({ tx_bytes: Buffer.from([0x01, 0x02, 0x03]).toString('base64') }),
  } as any

  beforeEach(() => {
    // resetAllMocks (not clearAllMocks): the first test below queues a
    // mockResolvedValueOnce/mockRejectedValueOnce pair, and clearAllMocks
    // leaves an unconsumed "once" queue in place for the next test.
    vi.resetAllMocks()
  })

  it('does not retry, and does not report success, when a transient-sounding rawLog is really a DeliverTx failure', async () => {
    // Attempt 1: the tx landed on-chain but execution reverted. Attempt 2 (if
    // the retry wrapper misread "aborted" as transient and resent the same
    // bytes) is wired to what the node actually says on a resend: "tx
    // already exists in cache" — which `cosmos.ts` treats as an idempotent
    // success. If that second mock is ever consulted, the assertion below
    // catches it: this is neavra's exact false-success-through-retry
    // reproduction, not just a call-count proxy.
    mocks.broadcastTx
      .mockResolvedValueOnce({
        code: 5,
        transactionHash: 'DEF456',
        height: 100,
        rawLog: 'wasm contract aborted: assertion failed',
      })
      .mockRejectedValueOnce(new Error('tx already exists in cache'))

    const rejection: unknown = await broadcastTx({ chain, tx }).catch(caught => caught)

    expect(rejection).toBeInstanceOf(DeliverTxFailedError)
    expect((rejection as Error).message).toMatch(/DEF456/)
    expect(mocks.broadcastTx).toHaveBeenCalledTimes(1)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  // A second, differently-worded transient pattern than the test above, so
  // this isn't just re-proving "aborted" — it shows the marker short-circuits
  // regardless of which transient phrase the chain-controlled rawLog happens
  // to contain.
  it('does not retry a DeliverTx failure whose rawLog reads "connection reset"', async () => {
    mocks.broadcastTx
      .mockResolvedValueOnce({
        code: 11,
        transactionHash: 'GHI789',
        height: 100,
        rawLog: 'connection reset by handler',
      })
      .mockRejectedValueOnce(new Error('tx already exists in cache'))

    await expect(broadcastTx({ chain, tx })).rejects.toThrow(/GHI789/)

    expect(mocks.broadcastTx).toHaveBeenCalledTimes(1)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('control: a genuine out-of-gas failure (non-transient wording) still throws with no retry', async () => {
    mocks.broadcastTx.mockResolvedValue({
      code: 11,
      transactionHash: 'ABC123',
      height: 100,
      rawLog: 'out of gas',
    })

    await expect(broadcastTx({ chain, tx })).rejects.toThrow(/ABC123/)

    expect(mocks.broadcastTx).toHaveBeenCalledTimes(1)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })
})
