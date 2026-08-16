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

// Regression coverage for sdk#1383 — the CheckTx sibling of the DeliverTx
// false-success bug sdk#1316 closed (see cosmosDeliverTxRetry.test.ts).
//
// cosmjs's StargateClient.broadcastTxSync rejects with a BroadcastTxError on a
// non-zero CheckTx code — the node rejected the tx before it ever reached the
// mempool. That rejection lands in `broadcastCosmosTx`'s `error` branch, which
// calls `verifyBroadcastByHash`; when hash verification can't find the tx (it
// genuinely never broadcast), the original BroadcastTxError re-throws into
// `withTransientBroadcastRetry`. If the chain-controlled `log` text happens to
// read as transient ("aborted", "timed out", "connection reset" — all real
// ante-handler/wasm phrasings), the bare message-regex classifier used to
// retry the resend, which can come back "tx already exists in cache" and get
// swallowed as a false success.
describe('broadcastTx cosmos CheckTx-rejection retry interlock', () => {
  const chain = CosmosChain.THORChain
  const tx = {
    serialized: JSON.stringify({ tx_bytes: Buffer.from([0x01, 0x02, 0x03]).toString('base64') }),
  } as any

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('does not retry, and does not report success, when a transient-sounding CheckTx log is a genuine node rejection', async () => {
    const checkTxRejection = new BroadcastTxError(5, 'wasm', 'wasm contract aborted: assertion failed')

    // Attempt 1: node rejects at CheckTx. verifyBroadcastByHash can't find the
    // tx (it never broadcast) and re-throws the original error. Attempt 2 (if
    // the retry wrapper misread "aborted" as transient and resent the same
    // bytes) is wired to what a resend can come back as: "tx already exists
    // in cache" — which `cosmos.ts` treats as an idempotent success. If that
    // second mock is ever consulted, the assertion below catches it.
    mocks.broadcastTx
      .mockRejectedValueOnce(checkTxRejection)
      .mockRejectedValueOnce(new Error('tx already exists in cache'))
    mocks.verifyBroadcastByHash.mockRejectedValueOnce(checkTxRejection)

    const rejection: unknown = await broadcastTx({ chain, tx }).catch(caught => caught)

    expect(rejection).toBe(checkTxRejection)
    expect(mocks.broadcastTx).toHaveBeenCalledTimes(1)
  })

  it('does not retry a CheckTx rejection whose log reads "connection reset"', async () => {
    const checkTxRejection = new BroadcastTxError(11, 'sdk', 'connection reset by handler')

    mocks.broadcastTx
      .mockRejectedValueOnce(checkTxRejection)
      .mockRejectedValueOnce(new Error('tx already exists in cache'))
    mocks.verifyBroadcastByHash.mockRejectedValueOnce(checkTxRejection)

    await expect(broadcastTx({ chain, tx })).rejects.toBe(checkTxRejection)

    expect(mocks.broadcastTx).toHaveBeenCalledTimes(1)
  })

  it('control: a genuine CheckTx rejection with non-transient wording still throws with no retry', async () => {
    const checkTxRejection = new BroadcastTxError(11, 'sdk', 'insufficient fee')

    mocks.broadcastTx.mockRejectedValue(checkTxRejection)
    mocks.verifyBroadcastByHash.mockRejectedValue(checkTxRejection)

    await expect(broadcastTx({ chain, tx })).rejects.toBe(checkTxRejection)

    expect(mocks.broadcastTx).toHaveBeenCalledTimes(1)
  })
})
