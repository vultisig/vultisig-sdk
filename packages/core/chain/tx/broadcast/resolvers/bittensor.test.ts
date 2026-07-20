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

  it('returns silently when the node accepts the extrinsic (result present)', async () => {
    mocks.queryUrl.mockResolvedValue({ result: '0xhash' })
    await expect(broadcastBittensorTx({ chain, tx })).resolves.toBeUndefined()
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('swallows the idempotent "Already Imported" peer-race error', async () => {
    mocks.queryUrl.mockResolvedValue({ error: { code: 1013, message: 'Transaction Already Imported' } })
    await expect(broadcastBittensorTx({ chain, tx })).resolves.toBeUndefined()
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('verifies by hash on a genuine error', async () => {
    mocks.queryUrl.mockResolvedValue({ error: { code: 1010, message: 'Invalid Transaction' } })
    await broadcastBittensorTx({ chain, tx })
    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledOnce()
  })

  // The gap: a malformed/truncated body with neither error nor result used to return undefined = success.
  it('does NOT assume success on a malformed response (neither error nor result) — verifies by hash', async () => {
    mocks.queryUrl.mockResolvedValue({})
    await broadcastBittensorTx({ chain, tx })
    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledOnce()
  })

  // #1430-class retry-interlock: bittensor runs inside `withTransientBroadcastRetry`
  // (index.ts hasResolverOwnedRetry = evm|solana only). When hash verification
  // cannot confirm the tx, verifyBroadcastByHash rethrows the original error and
  // it escapes to the retry wrapper. That error MUST be classified non-transient
  // so a genuinely-failed/unconfirmed broadcast is not silently re-sent up to 3×.
  it('surfaces the malformed-response failure as a NON-transient error (must not be re-broadcast)', async () => {
    mocks.queryUrl.mockResolvedValue({})
    // Simulate verification unable to confirm the tx on-chain → rethrow.
    mocks.verifyBroadcastByHash.mockImplementation(async ({ error }) => {
      throw error
    })
    await expect(broadcastBittensorTx({ chain, tx })).rejects.toThrow(/missing extrinsic hash/)
    const err = await broadcastBittensorTx({ chain, tx }).catch(e => e)
    expect(isTransientBroadcastError(err)).toBe(false)
  })
})
