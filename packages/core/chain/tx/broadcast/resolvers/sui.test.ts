import { afterEach, describe, expect, it, vi } from 'vitest'

import { OtherChain } from '../../../Chain'

const { mockExecute, mockVerify } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockVerify: vi.fn(async () => {}),
}))
vi.mock('@vultisig/core-chain/chains/sui/client', () => ({ getSuiClient: () => ({ executeTransactionBlock: mockExecute }) }))
vi.mock('../verifyBroadcastByHash', () => ({ verifyBroadcastByHash: mockVerify }))

import { broadcastSuiTx } from './sui'

const tx = { unsignedTx: 'tx-block', signature: 'sig' } as never

describe('broadcastSuiTx — sdk#1398 MoveAbort false-success', () => {
  afterEach(() => vi.clearAllMocks())

  it('requests effects and throws when the tx aborts on-chain (effects.status = failure)', async () => {
    mockExecute.mockResolvedValueOnce({ digest: '0xabc', effects: { status: { status: 'failure', error: 'MoveAbort' } } })
    await expect(broadcastSuiTx({ chain: OtherChain.Sui, tx })).rejects.toThrow(/failed on-chain/i)
    expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({ options: { showEffects: true } }))
    // A genuinely-failed Move is NOT fed back into verifyBroadcastByHash (it's on-chain, not un-broadcast).
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
