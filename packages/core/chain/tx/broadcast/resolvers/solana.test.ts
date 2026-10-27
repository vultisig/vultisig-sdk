import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendJitoTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  getSignatureStatuses: vi.fn(),
  getBlockHeight: vi.fn(),
  getLatestBlockhash: vi.fn(),
  verifyBroadcastByHash: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/solana/jito', () => ({
  sendJitoTransaction: mocks.sendJitoTransaction,
}))

vi.mock('@vultisig/core-chain/chains/solana/client', () => ({
  solanaRpcUrl: 'https://solana.rpc.test/',
  getSolanaClient: () => ({
    getSignatureStatuses: mocks.getSignatureStatuses,
    getBlockHeight: mocks.getBlockHeight,
    getLatestBlockhash: mocks.getLatestBlockhash,
  }),
}))

vi.mock('../verifyBroadcastByHash', () => ({
  verifyBroadcastByHash: mocks.verifyBroadcastByHash,
}))

import { Chain } from '../../../Chain'
import { solanaRpcTimeoutMs } from '../../../chains/solana/rpcTimeout'
import { SolanaSendTransactionError } from '../../../chains/solana/sendTransaction'
import { BroadcastErrorCode } from '../resolver'
import { SolanaBlockhashExpiredError } from '../solanaBlockhashExpired'
import { broadcastSolanaTx, solanaBroadcastMaxDurationMs, solanaRebroadcastIntervalMs } from './solana'

const signature = '2gB3ifNe2kSoJEYoVY7T4vw2z5ci9nL6WcQQuCC2ozCiURBwSfC9uGcCq9CS2pAzX7ed1xwyS4434BmSg2WhrZ7j'

const unseen = { value: [null] }
const processed = { value: [{ err: null, confirmationStatus: 'processed' }] }
const confirmed = { value: [{ err: null, confirmationStatus: 'confirmed' }] }
const revertedOnChain = { value: [{ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'confirmed' }] }

// The sendTransaction config on the wire. A resend reads `processed`, as
// web3.js always sent whenever preflight was skipped.
const firstSendConfig = { encoding: 'base64', maxRetries: 0, preflightCommitment: 'confirmed' }
const resendConfig = { encoding: 'base64', maxRetries: 0, skipPreflight: true, preflightCommitment: 'processed' }

const rpcResult = (result: string) => ({ jsonrpc: '2.0', id: 1, result })

// A preflight rejection in the shape mainnet returns it: a fixed message, the
// verdict only in `data.err`. Verbatim for BlockhashNotFound and AccountNotFound
// from api.mainnet-beta.solana.com and the Vultisig proxy (2026-10-27).
const preflightFailure = (err: unknown, logs: string[] = []) => ({
  jsonrpc: '2.0',
  id: 1,
  error: { code: -32002, message: 'Transaction simulation failed', data: { err, logs } },
})

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
    // Only sendTransaction goes over fetch; every other RPC is on the mocked client.
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = await mocks.sendTransaction(...JSON.parse(String(init.body)).params)
      return { ok: true, status: 200, json: async () => body }
    })
    mocks.sendTransaction.mockResolvedValue(rpcResult(signature))
    mocks.getSignatureStatuses.mockResolvedValue(confirmed)
    mocks.getBlockHeight.mockResolvedValue(100)
    mocks.getLatestBlockhash.mockResolvedValue({ blockhash: 'latest', lastValidBlockHeight: 150 })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('relays through standard RPC even when JITO accepts, and accepts once the signature is confirmed', async () => {
    await expect(broadcast()).resolves.toEqual({ status: 'accepted', finality: 'pending', txHash: signature })

    expect(mocks.sendJitoTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.sendTransaction).toHaveBeenCalledWith(expect.any(String), firstSendConfig)
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
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(solanaRebroadcastIntervalMs * 2)
    await expect(promise).resolves.toMatchObject({ status: 'accepted', txHash: signature })

    expect(mocks.sendTransaction).toHaveBeenCalledTimes(3)
    expect(mocks.sendTransaction).toHaveBeenNthCalledWith(1, expect.any(String), firstSendConfig)
    expect(mocks.sendTransaction).toHaveBeenNthCalledWith(2, expect.any(String), resendConfig)
    expect(mocks.sendTransaction).toHaveBeenNthCalledWith(3, expect.any(String), resendConfig)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('keeps resending while the signature is only processed, since a fork can still drop it', async () => {
    mocks.getSignatureStatuses.mockResolvedValueOnce(processed).mockResolvedValue(confirmed)

    const promise = broadcast(150)
    await vi.advanceTimersByTimeAsync(solanaRebroadcastIntervalMs)
    await expect(promise).resolves.toMatchObject({ status: 'accepted' })

    expect(mocks.sendTransaction).toHaveBeenCalledTimes(2)
  })

  // The broadcast layer reports "the node took the bytes"; the downstream
  // status poll reads `signatureStatus.err` and surfaces the revert.
  it('stops resending once the transaction executed, even when it reverted on-chain', async () => {
    mocks.getSignatureStatuses.mockResolvedValue(revertedOnChain)

    await expect(broadcast(150)).resolves.toMatchObject({ status: 'accepted', txHash: signature })

    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1)
  })

  it('fails with a re-sign verdict once the deadline passes with the signature still unseen', async () => {
    mocks.getSignatureStatuses.mockResolvedValue(unseen)
    mocks.getBlockHeight.mockResolvedValueOnce(100).mockResolvedValue(151)

    const promise = broadcast(150)
    await vi.advanceTimersByTimeAsync(solanaRebroadcastIntervalMs)
    const result = await promise

    expectExpiry(result, { signature, lastValidBlockHeight: 150 })
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(2)
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

  // The shared client has no request timeout, and the deadline checks only run
  // between awaits, so an RPC call that never answers must not hold the
  // resolver open. This hangs both the in-loop lookup and the final history
  // lookup: each times out, counts as "no information", and the loop moves on.
  it('resolves at the deadline when the history lookup never settles', async () => {
    const neverSettles = new Promise<never>(() => {})
    mocks.getSignatureStatuses.mockResolvedValueOnce(unseen).mockReturnValue(neverSettles)
    mocks.getBlockHeight.mockResolvedValueOnce(100).mockResolvedValue(151)

    const promise = broadcast(150)
    await vi.advanceTimersByTimeAsync(solanaRebroadcastIntervalMs)
    // Iteration 2's lookup hangs, then the deadline is seen, then the final
    // history lookup hangs. Two timeouts and the resolver must have answered.
    await vi.advanceTimersByTimeAsync(solanaRpcTimeoutMs * 2)

    await expect(promise).resolves.toMatchObject({ status: 'accepted', txHash: signature })
    expect(mocks.getSignatureStatuses).toHaveBeenLastCalledWith([signature], { searchTransactionHistory: true })
  })

  it('reports a transport failure, not expiry, when history is unusable and the bytes were never accepted', async () => {
    const transport = new Error('ECONNRESET')
    mocks.sendTransaction.mockRejectedValue(transport)
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

    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1)
  })

  it('treats a block-height-exceeded rejection as the expiry itself', async () => {
    mocks.sendTransaction.mockRejectedValue(new Error('Transaction simulation failed: block height exceeded'))
    mocks.getSignatureStatuses.mockResolvedValue(unseen)

    expectExpiry(await broadcast(150), { signature, lastValidBlockHeight: 150 })
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('keeps preflight on while a blockhash miss is still propagating, then accepts', async () => {
    mocks.sendTransaction
      .mockResolvedValueOnce(preflightFailure('BlockhashNotFound'))
      .mockResolvedValue(rpcResult(signature))
    mocks.getSignatureStatuses.mockResolvedValueOnce(unseen).mockResolvedValue(confirmed)

    const promise = broadcast(150)
    await vi.advanceTimersByTimeAsync(solanaRebroadcastIntervalMs)
    await expect(promise).resolves.toMatchObject({ status: 'accepted', txHash: signature })

    expect(mocks.sendTransaction).toHaveBeenNthCalledWith(2, expect.any(String), firstSendConfig)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('resends through a persistent blockhash miss and reports expiry once the deadline passes', async () => {
    mocks.sendTransaction.mockResolvedValue(preflightFailure('BlockhashNotFound'))
    mocks.getSignatureStatuses.mockResolvedValue(unseen)
    mocks.getBlockHeight.mockResolvedValueOnce(100).mockResolvedValueOnce(120).mockResolvedValue(151)

    const promise = broadcast(150)
    await vi.advanceTimersByTimeAsync(solanaRebroadcastIntervalMs * 2)

    expectExpiry(await promise, { signature, lastValidBlockHeight: 150 })
    // Never accepted, so every resend keeps preflight on.
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(3)
    expect(mocks.sendTransaction).toHaveBeenNthCalledWith(3, expect.any(String), firstSendConfig)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  // A payload signed against a blockhash that has already aged out: the node
  // answers BlockhashNotFound and the chain is past the deadline from the start.
  it('reports a blockhash miss as expiry at once when the deadline has already passed', async () => {
    mocks.sendTransaction.mockResolvedValue(preflightFailure('BlockhashNotFound'))
    mocks.getSignatureStatuses.mockResolvedValue(unseen)
    mocks.getBlockHeight.mockResolvedValue(151)

    expectExpiry(await broadcast(150), { signature, lastValidBlockHeight: 150 })
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('retries a transport failure on the first send instead of giving up', async () => {
    mocks.sendTransaction.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValue(rpcResult(signature))
    mocks.getSignatureStatuses.mockResolvedValueOnce(unseen).mockResolvedValue(confirmed)

    const promise = broadcast(150)
    await vi.advanceTimersByTimeAsync(solanaRebroadcastIntervalMs)
    await expect(promise).resolves.toMatchObject({ status: 'accepted', txHash: signature })

    expect(mocks.sendTransaction).toHaveBeenCalledTimes(2)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('routes a preflight rejection of the bytes through hash verification, with the deadline', async () => {
    mocks.sendTransaction.mockResolvedValue(preflightFailure('AccountNotFound'))
    mocks.verifyBroadcastByHash.mockResolvedValue('verified-hash')

    await expect(broadcast(150)).resolves.toMatchObject({ status: 'accepted', txHash: 'verified-hash' })

    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledWith({
      chain: Chain.Solana,
      tx,
      error: expect.any(SolanaSendTransactionError),
      lastValidBlockHeight: 150,
    })
  })

  it('returns a definitive failure naming the verdict when hash verification cannot confirm the bytes', async () => {
    mocks.sendTransaction.mockResolvedValue(preflightFailure('AccountNotFound'))
    mocks.verifyBroadcastByHash.mockImplementation(async ({ error }) => {
      throw error
    })

    const result = await broadcast(150)

    expect(result).toMatchObject({
      status: 'failed',
      code: BroadcastErrorCode.Rejected,
      retryable: false,
      cause: expect.any(SolanaSendTransactionError),
    })
    expect(result).toHaveProperty('cause.message', 'Transaction simulation failed: AccountNotFound')
  })

  it('hoists program logs into the verified error message, after the verdict', async () => {
    mocks.sendTransaction.mockResolvedValue(
      preflightFailure({ InstructionError: [0, { Custom: 1 }] }, [
        'Program 11111111111111111111111111111111 invoke [1]',
        'Program 11111111111111111111111111111111 failed: insufficient lamports',
      ])
    )
    mocks.verifyBroadcastByHash.mockResolvedValue('verified-hash')

    await broadcast(150)

    const { error } = mocks.verifyBroadcastByHash.mock.calls[0][0]
    expect(error.cause).toBeInstanceOf(SolanaSendTransactionError)
    expect(error.message).toBe(
      [
        'Transaction simulation failed: {"InstructionError":[0,{"Custom":1}]}',
        'Program 11111111111111111111111111111111 invoke [1]',
        'Program 11111111111111111111111111111111 failed: insufficient lamports',
      ].join('\n')
    )
  })

  // Program logs are the program's own text. One that reads like a blockhash
  // miss must not turn a rejected instruction into a resend loop.
  it('classifies on the node verdict, never on program logs', async () => {
    mocks.sendTransaction.mockResolvedValue(
      preflightFailure({ InstructionError: [0, { Custom: 1 }] }, ['Program log: Blockhash not found'])
    )
    mocks.verifyBroadcastByHash.mockImplementation(async ({ error }) => {
      throw error
    })

    await expect(broadcast(150)).resolves.toMatchObject({ status: 'failed', retryable: false })
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1)
  })

  it('falls back to standard RPC when JITO rejects the transaction', async () => {
    mocks.sendJitoTransaction.mockRejectedValue(new Error('jito unavailable'))

    await expect(broadcast(150)).resolves.toMatchObject({ status: 'accepted' })

    expect(mocks.sendJitoTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1)
  })

  // Pins the BROADCAST-LAYER decision for the AlreadyProcessed branch so a
  // future refactor that re-routes it (back through verifyBroadcastByHash, or
  // into a resend) is caught here. The authority on real success/failure is
  // the downstream getTxStatus confirmation poll (see the status-resolver test).
  it('treats a duplicate-signature rejection as an idempotent success: one send, no verification', async () => {
    mocks.sendTransaction.mockResolvedValue(preflightFailure('AlreadyProcessed'))

    await expect(broadcast(150)).resolves.toMatchObject({ status: 'accepted', txHash: signature })

    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('hands accepted bytes to the status poll at the wall-clock cap when no deadline could be established', async () => {
    mocks.getLatestBlockhash.mockRejectedValue(new Error('rpc down'))
    mocks.getSignatureStatuses.mockResolvedValue(unseen)

    const promise = broadcast()
    await vi.advanceTimersByTimeAsync(solanaBroadcastMaxDurationMs)
    await expect(promise).resolves.toMatchObject({ status: 'accepted', txHash: signature })

    expect(mocks.getBlockHeight).not.toHaveBeenCalled()
    expect(mocks.sendTransaction.mock.calls.length).toBeGreaterThan(
      solanaBroadcastMaxDurationMs / solanaRebroadcastIntervalMs
    )
  })

  it('fails retryably at the wall-clock cap when the RPC never accepted the bytes', async () => {
    const transport = new Error('ECONNRESET')
    mocks.getLatestBlockhash.mockRejectedValue(new Error('rpc down'))
    mocks.sendTransaction.mockRejectedValue(transport)
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
