import { afterEach, describe, expect, it, vi } from 'vitest'

import { OtherChain } from '../../../Chain'
import { isTransientBroadcastError, withTransientBroadcastRetry } from '../transientRetry'

const { mockExecute, mockVerify } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockVerify: vi.fn(async () => {}),
}))
vi.mock('@vultisig/core-chain/chains/sui/client', () => ({
  getSuiClient: () => ({ executeTransactionBlock: mockExecute }),
}))
vi.mock('../verifyBroadcastByHash', () => ({ verifyBroadcastByHash: mockVerify }))

import { broadcastSuiTx } from './sui'

const tx = { unsignedTx: 'tx-block', signature: 'sig' } as never

describe('broadcastSuiTx — sdk#1398 MoveAbort false-success', () => {
  afterEach(() => vi.clearAllMocks())

  it('requests effects and throws when the tx aborts on-chain (effects.status = failure)', async () => {
    mockExecute.mockResolvedValueOnce({
      digest: '0xabc',
      effects: { status: { status: 'failure', error: 'MoveAbort' } },
    })
    await expect(broadcastSuiTx({ chain: OtherChain.Sui, tx })).rejects.toThrow(/failed on-chain/i)
    expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({ options: { showEffects: true } }))
    // A genuinely-failed Move is NOT fed back into verifyBroadcastByHash (it's on-chain, not un-broadcast).
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('fails closed when effects status is missing/unknown (must not default to success)', async () => {
    // With showEffects requested a real Sui RPC always returns effects; a response WITHOUT an
    // explicit 'success' status is not proven execution success and must NOT be reported as one.
    mockExecute.mockResolvedValueOnce({ digest: '0xabc' })
    await expect(broadcastSuiTx({ chain: OtherChain.Sui, tx })).rejects.toThrow()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('the on-chain-failure throw is NOT classified transient (would otherwise be re-sent)', async () => {
    // The fallback abort message literally contains "aborted", which isTransientBroadcastError's
    // message regex matches — DeliverTxFailedError must short-circuit that before a re-send.
    mockExecute.mockResolvedValueOnce({ digest: '0xabc', effects: { status: { status: 'failure' } } })
    const err = await broadcastSuiTx({ chain: OtherChain.Sui, tx }).catch((e: unknown) => e)
    expect(isTransientBroadcastError(err)).toBe(false)
  })

  // neavra CR: sui is NOT in hasResolverOwnedRetry, so it runs INSIDE withTransientBroadcastRetry.
  // Exercise the resolver THROUGH the wrapper (the isolation blind spot that missed #1316 H1): an
  // on-chain MoveAbort must throw ONCE, not be re-broadcast 3x, and must not route into verify.
  it('does not re-broadcast an on-chain MoveAbort when run through withTransientBroadcastRetry', async () => {
    mockExecute.mockResolvedValue({ digest: '0xabc', effects: { status: { status: 'failure', error: 'MoveAbort' } } })

    await expect(withTransientBroadcastRetry(() => broadcastSuiTx({ chain: OtherChain.Sui, tx }))).rejects.toThrow(
      /failed on-chain/i
    )
    // Called exactly once = the wrapper did NOT retry the aborted tx (marker short-circuited).
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('returns the response when the tx executes successfully', async () => {
    const response = { digest: '0xabc', effects: { status: { status: 'success' } } }
    mockExecute.mockResolvedValueOnce(response)
    await expect(broadcastSuiTx({ chain: OtherChain.Sui, tx })).resolves.toBe(response)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('verifies by hash on an RPC-level error (unchanged behavior)', async () => {
    mockExecute.mockRejectedValueOnce(new Error('network'))
    await broadcastSuiTx({ chain: OtherChain.Sui, tx })
    expect(mockVerify).toHaveBeenCalledOnce()
  })
})
