import { BroadcastTxError } from '@cosmjs/stargate'
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
import { NodeRejectedBroadcastError } from './transientRetry'

// Regression coverage for the CheckTx-rejection door (sdk#1383): cosmos has
// no resolver-owned retry, so `broadcastCosmosTx`'s error branch runs INSIDE
// `withTransientBroadcastRetry`. cosmjs's `broadcastTxSync` throws a
// `BroadcastTxError` on a non-zero CheckTx code, with a chain-controlled
// `log` that can read as transient ("aborted", "connection reset" are real
// ante-handler/contract-revert strings). On a node with
// `keep-invalid-txs-in-cache=true`, CometBFT caches a REJECTED tx's hash the
// same as an accepted one, so a misclassified retry can come back "tx
// already exists in cache" purely from the rejection's own cache entry - no
// peer broadcast required - and get swallowed as success. Drives the real
// `broadcastTx` dispatcher, not just the resolver.
describe('broadcastTx cosmos CheckTx-rejection retry interlock', () => {
  const chain = CosmosChain.THORChain
  const tx = {
    serialized: JSON.stringify({ tx_bytes: Buffer.from([0x01, 0x02, 0x03]).toString('base64') }),
  } as any

  beforeEach(() => {
    // resetAllMocks: some tests below queue a mockRejectedValueOnce pair, and
    // clearAllMocks would leave an unconsumed "once" queue for the next test.
    vi.resetAllMocks()
    // Mirrors the real verifyBroadcastByHash's fallback behavior: rethrow
    // whatever error it was given when hash verification can't confirm the
    // tx landed on-chain.
    mocks.verifyBroadcastByHash.mockImplementation(({ error }: { error: unknown }) => Promise.reject(error))
  })

  it('does not retry, and does not report success, when a CheckTx rejection reads as transient', async () => {
    // Attempt 1: the node rejected these exact bytes at CheckTx. Attempt 2 (if
    // the retry wrapper misread "aborted" as transient and resent) is wired to
    // what a node with keep-invalid-txs-in-cache=true actually says on a
    // resend of an already-cached rejection: "tx already exists in cache" -
    // which cosmos.ts treats as an idempotent success. If that second mock is
    // ever consulted, the assertions below catch it.
    mocks.broadcastTx
      .mockRejectedValueOnce(new BroadcastTxError(5, 'wasm', 'wasm contract aborted: assertion failed'))
      .mockRejectedValueOnce(new Error('tx already exists in cache'))

    const rejection: unknown = await broadcastTx({ chain, tx }).catch(caught => caught)

    expect(rejection).toBeInstanceOf(NodeRejectedBroadcastError)
    expect((rejection as Error).message).toMatch(/aborted/)
    expect(mocks.broadcastTx).toHaveBeenCalledTimes(1)
  })

  // A second, differently-worded transient pattern, so this isn't just
  // re-proving "aborted".
  it('does not retry a CheckTx rejection whose log reads "connection reset"', async () => {
    mocks.broadcastTx
      .mockRejectedValueOnce(new BroadcastTxError(11, 'sdk', 'connection reset while validating'))
      .mockRejectedValueOnce(new Error('tx already exists in cache'))

    await expect(broadcastTx({ chain, tx })).rejects.toThrow(/connection reset/)

    expect(mocks.broadcastTx).toHaveBeenCalledTimes(1)
  })

  it('control: a genuine insufficient-funds rejection (non-transient wording) still throws with no retry', async () => {
    mocks.broadcastTx.mockRejectedValue(new BroadcastTxError(5, 'sdk', 'insufficient funds'))

    await expect(broadcastTx({ chain, tx })).rejects.toThrow(/insufficient funds/)

    expect(mocks.broadcastTx).toHaveBeenCalledTimes(1)
  })

  // Preserves the pre-existing MPC peer-race handling this fix must not
  // break: a first-attempt "tx already exists in cache" is still trusted as
  // success without ever reaching hash verification.
  it('still treats a first-attempt "tx already exists in cache" as idempotent success', async () => {
    mocks.broadcastTx.mockRejectedValue(new BroadcastTxError(19, 'sdk', 'tx already exists in cache'))

    await expect(broadcastTx({ chain, tx })).resolves.toBeUndefined()

    expect(mocks.broadcastTx).toHaveBeenCalledTimes(1)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })
})
