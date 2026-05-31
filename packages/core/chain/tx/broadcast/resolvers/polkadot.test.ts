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

import { OtherChain } from '../../../Chain'
import { broadcastPolkadotTx } from './polkadot'

describe('broadcastPolkadotTx', () => {
  const tx = { encoded: new Uint8Array([0x84, 0x00, 0x01]) } as any
  const chain = OtherChain.Polkadot

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns silently when the node accepts the extrinsic', async () => {
    mocks.queryUrl.mockResolvedValue({ result: '0xdeadbeef' })

    await expect(broadcastPolkadotTx({ chain, tx })).resolves.toBeUndefined()
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  describe('idempotent peer-race errors (MUST swallow)', () => {
    // The fast device wins the RPC race; the slower one gets one of these
    // Pool errors from substrate. The transaction is genuinely on chain /
    // in the pool — surfacing the error would put the slower MPC peer on
    // a "Signing Error" screen for a tx that did confirm.

    it('swallows "Transaction Already Imported"', async () => {
      mocks.queryUrl.mockResolvedValue({
        error: { code: 1013, message: 'Transaction Already Imported' },
      })

      await expect(broadcastPolkadotTx({ chain, tx })).resolves.toBeUndefined()
      expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
    })

    it('swallows "Transaction is temporarily banned"', async () => {
      mocks.queryUrl.mockResolvedValue({
        error: { code: 1010, message: 'Transaction is temporarily banned' },
      })

      await expect(broadcastPolkadotTx({ chain, tx })).resolves.toBeUndefined()
      expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
    })

    it('swallows generic "Already known" Pool error variants', async () => {
      mocks.queryUrl.mockResolvedValue({
        error: { code: 1013, message: 'Already known' },
      })

      await expect(broadcastPolkadotTx({ chain, tx })).resolves.toBeUndefined()
      expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
    })

    it('is case-insensitive', async () => {
      mocks.queryUrl.mockResolvedValue({
        error: { code: 1013, message: 'TRANSACTION ALREADY IMPORTED' },
      })

      await expect(broadcastPolkadotTx({ chain, tx })).resolves.toBeUndefined()
    })
  })

  describe('genuine broadcast failures (MUST surface)', () => {
    it('forwards BadProof to verifyBroadcastByHash and includes the data field', async () => {
      mocks.queryUrl.mockResolvedValue({
        error: {
          code: 1010,
          message: 'Invalid Transaction',
          data: 'Transaction has a bad signature',
        },
      })
      // verifyBroadcastByHash decides whether to re-throw; here just assert
      // we DID call it (i.e. did not silently swallow a bad-signature error).
      mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

      await broadcastPolkadotTx({ chain, tx })

      expect(mocks.verifyBroadcastByHash).toHaveBeenCalledOnce()
      const callArg = mocks.verifyBroadcastByHash.mock.calls[0]![0]
      expect(callArg.chain).toBe(chain)
      expect(callArg.tx).toBe(tx)
      // The `data` field is the actually diagnostic part of substrate's
      // InvalidTransaction response — surface it in the error message so
      // the UI does not collapse every kind of failure into "Invalid
      // Transaction" and strip the reason.
      expect((callArg.error as Error).message).toBe(
        'Polkadot broadcast failed: Invalid Transaction: Transaction has a bad signature'
      )
    })

    it('formats Stale rejections with the data field', async () => {
      mocks.queryUrl.mockResolvedValue({
        error: {
          code: 1010,
          message: 'Invalid Transaction',
          data: 'Transaction is outdated',
        },
      })
      mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

      await broadcastPolkadotTx({ chain, tx })

      const callArg = mocks.verifyBroadcastByHash.mock.calls[0]![0]
      expect((callArg.error as Error).message).toBe(
        'Polkadot broadcast failed: Invalid Transaction: Transaction is outdated'
      )
    })

    it('falls back to message alone when data is absent', async () => {
      mocks.queryUrl.mockResolvedValue({
        error: { code: 1010, message: 'Invalid Transaction' },
      })
      mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

      await broadcastPolkadotTx({ chain, tx })

      const callArg = mocks.verifyBroadcastByHash.mock.calls[0]![0]
      expect((callArg.error as Error).message).toBe('Polkadot broadcast failed: Invalid Transaction')
    })

    it('swallows InvalidTransaction whose data marks it duplicate', async () => {
      // Some node configurations route the "this hash is already in the
      // pool" signal through InvalidTransaction.data instead of the Pool
      // error message — detect both.
      mocks.queryUrl.mockResolvedValue({
        error: {
          code: 1010,
          message: 'Invalid Transaction',
          data: 'Already known',
        },
      })

      await expect(broadcastPolkadotTx({ chain, tx })).resolves.toBeUndefined()
      expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
    })

    it('routes the missing-result case through verifyBroadcastByHash', async () => {
      mocks.queryUrl.mockResolvedValue({})
      mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

      await broadcastPolkadotTx({ chain, tx })

      expect(mocks.verifyBroadcastByHash).toHaveBeenCalledOnce()
      const callArg = mocks.verifyBroadcastByHash.mock.calls[0]![0]
      expect((callArg.error as Error).message).toContain('missing extrinsic hash')
    })

    it('routes network-level errors through verifyBroadcastByHash', async () => {
      const networkErr = new Error('ECONNRESET')
      mocks.queryUrl.mockRejectedValue(networkErr)
      mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

      await broadcastPolkadotTx({ chain, tx })

      expect(mocks.verifyBroadcastByHash).toHaveBeenCalledOnce()
      expect(mocks.verifyBroadcastByHash.mock.calls[0]![0]!.error).toBe(networkErr)
    })
  })
})
