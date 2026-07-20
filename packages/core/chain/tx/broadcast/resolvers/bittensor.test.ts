import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryUrl: vi.fn(),
  verifyBroadcastByHash: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({ queryUrl: mocks.queryUrl }))
vi.mock('../verifyBroadcastByHash', () => ({ verifyBroadcastByHash: mocks.verifyBroadcastByHash }))
vi.mock('@vultisig/core-chain/chains/bittensor/client', () => ({ bittensorRpcUrl: 'https://bittensor.test' }))

import { OtherChain } from '../../../Chain'
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
})
