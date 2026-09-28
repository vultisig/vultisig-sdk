import { SolanaJSONRPCError } from '@solana/web3.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBlockHeight: vi.fn(),
  getSignatureStatuses: vi.fn(),
  getTransaction: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/solana/client', () => ({
  getSolanaClient: () => ({
    getBlockHeight: mocks.getBlockHeight,
    getSignatureStatuses: mocks.getSignatureStatuses,
    getTransaction: mocks.getTransaction,
  }),
}))

import { Chain } from '../../../Chain'
import { solanaRpcTimeoutMs } from '../../../chains/solana/rpcTimeout'
import { getSolanaTxStatus } from './solana'

describe('getSolanaTxStatus', () => {
  const hash = '2gB3ifNe2kSoJEYoVY7T4vw2z5ci9nL6WcQQuCC2ozCiURBwSfC9uGcCq9CS2pAzX7ed1xwyS4434BmSg2WhrZ7j'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports missing signatures as not_found when no last valid block height is supplied', async () => {
    mocks.getSignatureStatuses.mockResolvedValue({ value: [null] })

    await expect(getSolanaTxStatus({ chain: Chain.Solana, hash })).resolves.toEqual({
      status: 'not_found',
      isKnown: false,
    })
    expect(mocks.getBlockHeight).not.toHaveBeenCalled()
    expect(mocks.getTransaction).not.toHaveBeenCalled()
  })

  it('marks an unknown signature as expired once its last valid block height has passed', async () => {
    mocks.getSignatureStatuses.mockResolvedValue({ value: [null] })
    mocks.getBlockHeight.mockResolvedValue(101)

    await expect(getSolanaTxStatus({ chain: Chain.Solana, hash, lastValidBlockHeight: 100 })).resolves.toEqual({
      status: 'expired',
      isKnown: false,
    })
    // The verdict rests on an absence observed AFTER the height, not before it.
    expect(mocks.getSignatureStatuses).toHaveBeenCalledTimes(2)
    expect(mocks.getSignatureStatuses).toHaveBeenLastCalledWith([hash], { searchTransactionHistory: true })
    expect(mocks.getTransaction).not.toHaveBeenCalled()
  })

  // A transfer can land in its last valid block while the height request is
  // in flight. The first absence is then stale, and calling it `expired` would
  // stop the poll and send the user to re-sign a payment that executed.
  it('recovers a signature that lands while the block height is being read', async () => {
    mocks.getSignatureStatuses
      .mockResolvedValueOnce({ value: [null] })
      .mockResolvedValue({ value: [{ err: null, confirmationStatus: 'confirmed' }] })
    mocks.getBlockHeight.mockResolvedValue(101)
    mocks.getTransaction.mockResolvedValue({ meta: { err: null, fee: 5000 } })

    const result = await getSolanaTxStatus({ chain: Chain.Solana, hash, lastValidBlockHeight: 100 })

    expect(result).toMatchObject({ status: 'success', receipt: { feeAmount: 5000n } })
    expect(mocks.getSignatureStatuses).toHaveBeenCalledTimes(2)
  })

  it('keeps an unknown signature pending when the post-expiry re-read fails', async () => {
    mocks.getSignatureStatuses.mockResolvedValueOnce({ value: [null] }).mockRejectedValue(new Error('rpc down'))
    mocks.getBlockHeight.mockResolvedValue(101)

    await expect(getSolanaTxStatus({ chain: Chain.Solana, hash, lastValidBlockHeight: 100 })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
    expect(mocks.getTransaction).not.toHaveBeenCalled()
  })

  it('keeps an unknown signature pending when its last valid block height has not expired', async () => {
    mocks.getSignatureStatuses.mockResolvedValue({ value: [null] })
    mocks.getBlockHeight.mockResolvedValue(100)

    await expect(getSolanaTxStatus({ chain: Chain.Solana, hash, lastValidBlockHeight: 100 })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
    expect(mocks.getTransaction).not.toHaveBeenCalled()
  })

  it('keeps an unknown signature pending when block-height lookup fails', async () => {
    mocks.getSignatureStatuses.mockResolvedValue({ value: [null] })
    mocks.getBlockHeight.mockRejectedValue(new Error('rpc down'))

    await expect(getSolanaTxStatus({ chain: Chain.Solana, hash, lastValidBlockHeight: 100 })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
    expect(mocks.getTransaction).not.toHaveBeenCalled()
  })

  it('keeps a signature-status lookup failure pending without attempting expiry classification', async () => {
    mocks.getSignatureStatuses.mockRejectedValue(new Error('rpc down'))

    await expect(getSolanaTxStatus({ chain: Chain.Solana, hash, lastValidBlockHeight: 100 })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
    expect(mocks.getBlockHeight).not.toHaveBeenCalled()
    expect(mocks.getTransaction).not.toHaveBeenCalled()
  })

  it('rejects an 88-character zero-byte base58 signature locally', async () => {
    await expect(getSolanaTxStatus({ chain: Chain.Solana, hash: '1'.repeat(88) })).resolves.toEqual({
      status: 'not_found',
      isKnown: false,
    })
    expect(mocks.getSignatureStatuses).not.toHaveBeenCalled()
    expect(mocks.getBlockHeight).not.toHaveBeenCalled()
    expect(mocks.getTransaction).not.toHaveBeenCalled()
  })

  it('rejects a base58 value that decodes to 32 bytes locally', async () => {
    await expect(getSolanaTxStatus({ chain: Chain.Solana, hash: '1'.repeat(32) })).resolves.toEqual({
      status: 'not_found',
      isKnown: false,
    })
    expect(mocks.getSignatureStatuses).not.toHaveBeenCalled()
    expect(mocks.getBlockHeight).not.toHaveBeenCalled()
    expect(mocks.getTransaction).not.toHaveBeenCalled()
  })

  it('rejects non-base58 signature characters locally', async () => {
    await expect(getSolanaTxStatus({ chain: Chain.Solana, hash: '0OIl' })).resolves.toEqual({
      status: 'not_found',
      isKnown: false,
    })
    expect(mocks.getSignatureStatuses).not.toHaveBeenCalled()
    expect(mocks.getBlockHeight).not.toHaveBeenCalled()
    expect(mocks.getTransaction).not.toHaveBeenCalled()
  })

  it('keeps Solana JSON-RPC errors pending regardless of their code', async () => {
    for (const code of [-32602, -32013]) {
      mocks.getSignatureStatuses.mockRejectedValue(
        new SolanaJSONRPCError({ code, message: 'RPC rejected signature status lookup' })
      )

      await expect(getSolanaTxStatus({ chain: Chain.Solana, hash })).resolves.toEqual({
        status: 'pending',
        isKnown: false,
      })
    }
    expect(mocks.getSignatureStatuses).toHaveBeenCalledTimes(2)
    expect(mocks.getBlockHeight).not.toHaveBeenCalled()
    expect(mocks.getTransaction).not.toHaveBeenCalled()
  })

  it('marks known signatures as known pending until transaction details are indexed', async () => {
    mocks.getSignatureStatuses.mockResolvedValue({
      value: [{ err: null, confirmationStatus: 'processed' }],
    })
    mocks.getTransaction.mockResolvedValue(null)

    await expect(getSolanaTxStatus({ chain: Chain.Solana, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: true,
    })
  })

  // The AUTHORITY step for the broadcast-layer trade-off documented in
  // ../../broadcast/resolvers/solana.ts: an AlreadyProcessed broadcast can be a
  // *processed-but-reverted* tx that the broadcast resolver optimistically
  // reports as success. This proves the confirmation poll detects that revert —
  // a non-null `signatureStatus.err` returns status 'error' WITHOUT needing the
  // (possibly not-yet-indexed) transaction details, so a reverted Solana tx is
  // surfaced as a failure downstream.
  it('returns error when the signature status carries an execution error', async () => {
    mocks.getSignatureStatuses.mockResolvedValue({
      value: [{ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'finalized' }],
    })

    await expect(getSolanaTxStatus({ chain: Chain.Solana, hash })).resolves.toEqual({
      status: 'error',
      isKnown: true,
    })
    // The error is decided from the signature status alone — no tx fetch needed.
    expect(mocks.getTransaction).not.toHaveBeenCalled()
  })

  // The shared client has no request timeout. A request that never answers
  // must read as unavailable information, not hold the poll open for good.
  describe('when an RPC request never settles', () => {
    const neverSettles = new Promise<never>(() => {})
    const pending = { status: 'pending', isKnown: false }

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('keeps the transaction pending when the signature lookup never settles', async () => {
      mocks.getSignatureStatuses.mockReturnValue(neverSettles)

      const promise = getSolanaTxStatus({ chain: Chain.Solana, hash, lastValidBlockHeight: 100 })
      await vi.advanceTimersByTimeAsync(solanaRpcTimeoutMs)

      await expect(promise).resolves.toEqual(pending)
      expect(mocks.getBlockHeight).not.toHaveBeenCalled()
    })

    it('keeps an unknown signature pending when the block-height request never settles', async () => {
      mocks.getSignatureStatuses.mockResolvedValue({ value: [null] })
      mocks.getBlockHeight.mockReturnValue(neverSettles)

      const promise = getSolanaTxStatus({ chain: Chain.Solana, hash, lastValidBlockHeight: 100 })
      await vi.advanceTimersByTimeAsync(solanaRpcTimeoutMs)

      await expect(promise).resolves.toEqual(pending)
      // No expiry verdict without a height, so no second history read either.
      expect(mocks.getSignatureStatuses).toHaveBeenCalledTimes(1)
    })

    it('keeps a known signature pending when the transaction fetch never settles', async () => {
      mocks.getSignatureStatuses.mockResolvedValue({ value: [{ err: null, confirmationStatus: 'confirmed' }] })
      mocks.getTransaction.mockReturnValue(neverSettles)

      const promise = getSolanaTxStatus({ chain: Chain.Solana, hash })
      await vi.advanceTimersByTimeAsync(solanaRpcTimeoutMs)

      await expect(promise).resolves.toEqual({ status: 'pending', isKnown: true })
    })
  })
})
