import { SendTransactionError } from '@solana/web3.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendJitoTransaction: vi.fn(),
  sendRawTransaction: vi.fn(),
  getSignatureStatuses: vi.fn(),
  getBlockHeight: vi.fn(),
  getLatestBlockhash: vi.fn(),
  verifyBroadcastByHash: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/solana/jito', () => ({
  sendJitoTransaction: mocks.sendJitoTransaction,
}))

vi.mock('@vultisig/core-chain/chains/solana/client', () => ({
  getSolanaClient: () => ({
    sendRawTransaction: mocks.sendRawTransaction,
    getSignatureStatuses: mocks.getSignatureStatuses,
    getBlockHeight: mocks.getBlockHeight,
    getLatestBlockhash: mocks.getLatestBlockhash,
  }),
}))

vi.mock('../verifyBroadcastByHash', () => ({
  verifyBroadcastByHash: mocks.verifyBroadcastByHash,
}))

import { Chain } from '../../../Chain'
import { BroadcastErrorCode } from '../resolver'
import { SolanaBlockhashExpiredError } from '../solanaBlockhashExpired'
import { broadcastSolanaTx, solanaBroadcastMaxDurationMs, solanaRebroadcastIntervalMs } from './solana'

const signature = '2gB3ifNe2kSoJEYoVY7T4vw2z5ci9nL6WcQQuCC2ozCiURBwSfC9uGcCq9CS2pAzX7ed1xwyS4434BmSg2WhrZ7j'

const unseen = { value: [null] }
const processed = { value: [{ err: null, confirmationStatus: 'processed' }] }
const confirmed = { value: [{ err: null, confirmationStatus: 'confirmed' }] }
const revertedOnChain = { value: [{ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'confirmed' }] }

const firstSendOptions = { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 }
const resendOptions = { ...firstSendOptions, skipPreflight: true }

const expectExpiry = (result: unknown, expected: { signature?: string; lastValidBlockHeight?: number }) => {
  expect(result).toMatchObject({
    status: 'failed',
    code: BroadcastErrorCode.Rejected,
    retryable: false,
    cause: expect.any(SolanaBlockhashExpiredError),
  })
  expect(result).toHaveProperty('cause.recovery', 'resign')
  expect(result).toMatchObject({ cause: expected })
}

describe('broadcastSolanaTx', () => {
  const tx = { encoded: '1111', signatures: [{ pubkey: 'payer', signature }] } as any
  const broadcast = (lastValidBlockHeight?: number) =>
    broadcastSolanaTx({ chain: Chain.Solana, tx, lastValidBlockHeight })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mocks.sendJitoTransaction.mockResolvedValue('jito-signature')
    mocks.sendRawTransaction.mockResolvedValue(signature)
    mocks.getSignatureStatuses.mockResolvedValue(confirmed)
    mocks.getBlockHeight.mockResolvedValue(100)
    mocks.getLatestBlockhash.mockResolvedValue({ blockhash: 'latest', lastValidBlockHeight: 150 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('relays through standard RPC even when JITO accepts, and accepts once the signature is confirmed', async () => {
    await expect(broadcast()).resolves.toEqual({ status: 'accepted', finality: 'pending', txHash: signature })

    expect(mocks.sendJitoTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.sendRawTransaction).toHaveBeenCalledWith(expect.any(Uint8Array), firstSendOptions)
    expect(mocks.getSignatureStatuses).toHaveBeenCalledWith([signature], { searchTransactionHistory: false })
  })

  it('takes the deadline from the payload when it has one, and bounds it by the newest blockhash otherwise', async () => {
    await broadcast(120)
    expect(mocks.getLatestBlockhash).not.toHaveBeenCalled()

    await broadcast()
    expect(mocks.getLatestBlockhash).toHaveBeenCalledWith('confirmed')
  })

  it('resends the same bytes on an interval until the signature is confirmed, skipping preflight on resends', async () => {
    mocks.getSignatureStatuses.mockResolvedValueOnce(unseen).mockResolvedValueOnce(unseen).mockResolvedValue(confirmed)

    const promise = broadcast(150)
    await vi.advanceTimersByTimeAsync(solanaRebroadcastIntervalMs - 1)
    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(solanaRebroadcastIntervalMs * 2)
    await expect(promise).resolves.toMatchObject({ status: 'accepted', txHash: signature })

    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(3)
    expect(mocks.sendRawTransaction).toHaveBeenNthCalledWith(1, expect.any(Uint8Array), firstSendOptions)
    expect(mocks.sendRawTransaction).toHaveBeenNthCalledWith(2, expect.any(Uint8Array), resendOptions)
    expect(mocks.sendRawTransaction).toHaveBeenNthCalledWith(3, expect.any(Uint8Array), resendOptions)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('keeps resending while the signature is only processed, since a fork can still drop it', async () => {
    mocks.getSignatureStatuses.mockResolvedValueOnce(processed).mockResolvedValue(confirmed)

    const promise = broadcast(150)
    await vi.advanceTimersByTimeAsync(solanaRebroadcastIntervalMs)
    await expect(promise).resolves.toMatchObject({ status: 'accepted' })

    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(2)
  })

  // The broadcast layer reports "the node took the bytes"; the downstream
  // status poll reads `signatureStatus.err` and surfaces the revert.
  it('stops resending once the transaction executed, even when it reverted on-chain', async () => {
    mocks.getSignatureStatuses.mockResolvedValue(revertedOnChain)

    await expect(broadcast(150)).resolves.toMatchObject({ status: 'accepted', txHash: signature })

    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(1)
  })

  it('fails with a re-sign verdict once the deadline passes with the signature still unseen', async () => {
    mocks.getSignatureStatuses.mockResolvedValue(unseen)
    mocks.getBlockHeight.mockResolvedValueOnce(100).mockResolvedValue(151)

    const promise = broadcast(150)
    await vi.advanceTimersByTimeAsync(solanaRebroadcastIntervalMs)
    const result = await promise

    expectExpiry(result, { signature, lastValidBlockHeight: 150 })
    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(2)
    // The last look searches history: the bytes may have landed in the final valid block.
    expect(mocks.getSignatureStatuses).toHaveBeenLastCalledWith([signature], { searchTransactionHistory: true })
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  // A transfer can land in its last valid block while the status RPC is down.
  // Claiming a definitive expiry there would tell the user to sign again and
  // risk paying twice, so an unusable lookup must preserve uncertainty.
  it('does not declare expiry when the final history lookup fails on accepted bytes', async () => {
    mocks.getSignatureStatuses.mockResolvedValueOnce(unseen).mockRejectedValue(new Error('status rpc unavailable'))
    mocks.getBlockHeight.mockResolvedValueOnce(100).mockResolvedValue(151)

    const promise = broadcast(150)
    await vi.advanceTimersByTimeAsync(solanaRebroadcastIntervalMs)
    const result = await promise

    expect(result).toMatchObject({ status: 'accepted', txHash: signature })
    expect(result).not.toHaveProperty('cause')
    // It did try history before giving up on a verdict.
    expect(mocks.getSignatureStatuses).toHaveBeenLastCalledWith([signature], { searchTransactionHistory: true })
  })

  it('reports a transport failure, not expiry, when history is unusable and the bytes were never accepted', async () => {
    const transport = new Error('ECONNRESET')
    mocks.sendRawTransaction.mockRejectedValue(transport)
    mocks.getSignatureStatuses.mockRejectedValue(new Error('status rpc unavailable'))
    mocks.getBlockHeight.mockResolvedValueOnce(100).mockResolvedValue(151)

    const promise = broadcast(150)
    await vi.advanceTimersByTimeAsync(solanaRebroadcastIntervalMs)

    await expect(promise).resolves.toEqual({
      status: 'failed',
      code: BroadcastErrorCode.Transport,
      retryable: true,
      cause: transport,
    })
  })

  it('accepts a signature that turns up in the final history lookup at the deadline', async () => {
    mocks.getSignatureStatuses.mockResolvedValueOnce(unseen).mockResolvedValue(confirmed)
    mocks.getBlockHeight.mockResolvedValue(151)

    await expect(broadcast(150)).resolves.toMatchObject({ status: 'accepted', txHash: signature })

    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(1)
  })

  it('treats a block-height-exceeded rejection as the expiry itself', async () => {
    mocks.sendRawTransaction.mockRejectedValue(new Error('Transaction simulation failed: block height exceeded'))
    mocks.getSignatureStatuses.mockResolvedValue(unseen)

    expectExpiry(await broadcast(150), { signature, lastValidBlockHeight: 150 })
    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('keeps preflight on while a blockhash miss is still propagating, then accepts', async () => {
    mocks.sendRawTransaction.mockRejectedValueOnce(new Error('Blockhash not found')).mockResolvedValue(signature)
    mocks.getSignatureStatuses.mockResolvedValueOnce(unseen).mockResolvedValue(confirmed)

    const promise = broadcast(150)
    await vi.advanceTimersByTimeAsync(solanaRebroadcastIntervalMs)
    await expect(promise).resolves.toMatchObject({ status: 'accepted', txHash: signature })

    expect(mocks.sendRawTransaction).toHaveBeenNthCalledWith(2, expect.any(Uint8Array), firstSendOptions)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('reports a persistent blockhash miss as expiry once the deadline passes, not as a transport failure', async () => {
    mocks.sendRawTransaction.mockRejectedValue(new Error('BlockhashNotFound'))
    mocks.getSignatureStatuses.mockResolvedValue(unseen)
    mocks.getBlockHeight.mockResolvedValueOnce(100).mockResolvedValue(151)

    const promise = broadcast(150)
    await vi.advanceTimersByTimeAsync(solanaRebroadcastIntervalMs)

    expectExpiry(await promise, { signature, lastValidBlockHeight: 150 })
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('retries a transport failure on the first send instead of giving up', async () => {
    mocks.sendRawTransaction.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValue(signature)
    mocks.getSignatureStatuses.mockResolvedValueOnce(unseen).mockResolvedValue(confirmed)

    const promise = broadcast(150)
    await vi.advanceTimersByTimeAsync(solanaRebroadcastIntervalMs)
    await expect(promise).resolves.toMatchObject({ status: 'accepted', txHash: signature })

    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(2)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('routes a preflight rejection of the bytes through hash verification, with the deadline', async () => {
    const rejection = new Error('rpc rejected')
    mocks.sendRawTransaction.mockRejectedValue(rejection)
    mocks.verifyBroadcastByHash.mockResolvedValue('verified-hash')

    await expect(broadcast(150)).resolves.toMatchObject({ status: 'accepted', txHash: 'verified-hash' })

    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledWith({
      chain: Chain.Solana,
      tx,
      error: rejection,
      lastValidBlockHeight: 150,
    })
  })

  it('hoists SendTransactionError program logs into the verified error message', async () => {
    const sendError = new SendTransactionError({
      action: 'send',
      signature: 'sig',
      transactionMessage: 'Transaction simulation failed: custom program error: 0x1',
      logs: [
        'Program 11111111111111111111111111111111 invoke [1]',
        'Program 11111111111111111111111111111111 failed: insufficient lamports',
      ],
    })
    mocks.sendRawTransaction.mockRejectedValue(sendError)
    mocks.verifyBroadcastByHash.mockResolvedValue('verified-hash')

    await broadcast(150)

    const { error } = mocks.verifyBroadcastByHash.mock.calls[0][0]
    expect(error).toBeInstanceOf(Error)
    expect(error.cause).toBe(sendError)
    expect(error.message).toContain('Transaction simulation failed')
    expect(error.message).toContain('insufficient lamports')
  })

  it('returns a definitive failure when the bytes are rejected and hash verification cannot confirm them', async () => {
    const rejection = new Error('invalid signature')
    mocks.sendRawTransaction.mockRejectedValue(rejection)
    mocks.verifyBroadcastByHash.mockRejectedValue(rejection)

    await expect(broadcast(150)).resolves.toEqual({
      status: 'failed',
      code: BroadcastErrorCode.Rejected,
      retryable: false,
      cause: rejection,
    })
  })

  it('falls back to standard RPC when JITO rejects the transaction', async () => {
    mocks.sendJitoTransaction.mockRejectedValue(new Error('jito unavailable'))

    await expect(broadcast(150)).resolves.toMatchObject({ status: 'accepted' })

    expect(mocks.sendJitoTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(1)
  })

  // Pins the BROADCAST-LAYER decision for the AlreadyProcessed branch so a
  // future refactor that re-routes it (back through verifyBroadcastByHash, or
  // into a resend) is caught here. The authority on real success/failure is
  // the downstream getTxStatus confirmation poll (see the status-resolver test).
  it('treats a duplicate-signature rejection as an idempotent success: one send, no verification', async () => {
    mocks.sendRawTransaction.mockRejectedValue(new Error('This transaction has already been processed'))

    await expect(broadcast(150)).resolves.toMatchObject({ status: 'accepted', txHash: signature })

    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('treats an AlreadyProcessed transaction error as an idempotent success', async () => {
    mocks.sendRawTransaction.mockRejectedValue(new Error('Transaction error: AlreadyProcessed'))

    await expect(broadcast(150)).resolves.toMatchObject({ status: 'accepted' })

    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('hands accepted bytes to the status poll at the wall-clock cap when no deadline could be established', async () => {
    mocks.getLatestBlockhash.mockRejectedValue(new Error('rpc down'))
    mocks.getSignatureStatuses.mockResolvedValue(unseen)

    const promise = broadcast()
    await vi.advanceTimersByTimeAsync(solanaBroadcastMaxDurationMs)
    await expect(promise).resolves.toMatchObject({ status: 'accepted', txHash: signature })

    expect(mocks.getBlockHeight).not.toHaveBeenCalled()
    expect(mocks.sendRawTransaction.mock.calls.length).toBeGreaterThan(
      solanaBroadcastMaxDurationMs / solanaRebroadcastIntervalMs
    )
  })

  it('fails retryably at the wall-clock cap when the RPC never accepted the bytes', async () => {
    const transport = new Error('ECONNRESET')
    mocks.getLatestBlockhash.mockRejectedValue(new Error('rpc down'))
    mocks.sendRawTransaction.mockRejectedValue(transport)
    mocks.getSignatureStatuses.mockResolvedValue(unseen)

    const promise = broadcast()
    await vi.advanceTimersByTimeAsync(solanaBroadcastMaxDurationMs)

    await expect(promise).resolves.toEqual({
      status: 'failed',
      code: BroadcastErrorCode.Transport,
      retryable: true,
      cause: transport,
    })
  })
})
