import { SendTransactionError } from '@solana/web3.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendJitoTransaction: vi.fn(),
  sendRawTransaction: vi.fn(),
  verifyBroadcastByHash: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/solana/jito', () => ({
  sendJitoTransaction: mocks.sendJitoTransaction,
}))

vi.mock('@vultisig/core-chain/chains/solana/client', () => ({
  getSolanaClient: () => ({
    sendRawTransaction: mocks.sendRawTransaction,
  }),
}))

vi.mock('../verifyBroadcastByHash', () => ({
  verifyBroadcastByHash: mocks.verifyBroadcastByHash,
}))

import { Chain } from '../../../Chain'
import { broadcastSolanaTx } from './solana'

describe('broadcastSolanaTx', () => {
  const tx = { encoded: '1111' } as any

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendJitoTransaction.mockResolvedValue('jito-signature')
    mocks.sendRawTransaction.mockResolvedValue('rpc-signature')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('relays through standard RPC even when JITO accepts the transaction', async () => {
    await broadcastSolanaTx({ chain: Chain.Solana, tx })

    expect(mocks.sendJitoTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.sendRawTransaction).toHaveBeenCalledWith(expect.any(Uint8Array), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
  })

  it('retries transient blockhash misses before accepting the standard RPC relay', async () => {
    vi.useFakeTimers()
    mocks.sendRawTransaction.mockRejectedValueOnce(new Error('Blockhash not found')).mockResolvedValue('rpc-signature')

    const promise = broadcastSolanaTx({ chain: Chain.Solana, tx })

    await vi.advanceTimersByTimeAsync(499)
    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    await promise

    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(2)
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('routes persistent blockhash misses through hash verification after bounded retries', async () => {
    vi.useFakeTimers()
    const rpcError = new Error('BlockhashNotFound')
    mocks.sendRawTransaction.mockRejectedValue(rpcError)
    mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

    const promise = broadcastSolanaTx({ chain: Chain.Solana, tx })

    await vi.advanceTimersByTimeAsync(1_500)
    await promise

    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(3)
    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledWith({
      chain: Chain.Solana,
      tx,
      error: rpcError,
    })
  })

  it('falls back to standard RPC when JITO rejects the transaction', async () => {
    mocks.sendJitoTransaction.mockRejectedValue(new Error('jito unavailable'))

    await broadcastSolanaTx({ chain: Chain.Solana, tx })

    expect(mocks.sendJitoTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(1)
  })

  it('verifies by hash when standard RPC rejects after JITO acceptance', async () => {
    const rpcError = new Error('rpc rejected')
    mocks.sendRawTransaction.mockRejectedValue(rpcError)
    mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

    await broadcastSolanaTx({ chain: Chain.Solana, tx })

    // A non-SendTransactionError is forwarded verbatim — nothing to hoist.
    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledWith({
      chain: Chain.Solana,
      tx,
      error: rpcError,
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
    mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

    await broadcastSolanaTx({ chain: Chain.Solana, tx })

    const { error } = mocks.verifyBroadcastByHash.mock.calls[0][0]
    expect(error).toBeInstanceOf(Error)
    expect(error.cause).toBe(sendError)
    expect(error.message).toContain('Transaction simulation failed')
    expect(error.message).toContain('insufficient lamports')
  })

  it('treats a duplicate-signature rejection as an idempotent success', async () => {
    mocks.sendRawTransaction.mockRejectedValue(new Error('This transaction has already been processed'))

    await expect(broadcastSolanaTx({ chain: Chain.Solana, tx })).resolves.toBeUndefined()

    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  it('treats an AlreadyProcessed transaction error as an idempotent success', async () => {
    mocks.sendRawTransaction.mockRejectedValue(new Error('Transaction error: AlreadyProcessed'))

    await expect(broadcastSolanaTx({ chain: Chain.Solana, tx })).resolves.toBeUndefined()

    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })

  // N1 — pins the BROADCAST-LAYER decision for the AlreadyProcessed branch so a
  // future refactor that re-routes it (e.g. back through verifyBroadcastByHash,
  // or into a re-broadcast) is caught here. This is the optimistic half of the
  // reviewed-and-accepted trade-off documented in solana.ts: broadcast reports
  // success WITHOUT verifying the execution outcome — the authority on real
  // success/failure is the downstream getTxStatus confirmation poll (see the
  // status-resolver test and the cross-layer test in
  // clients/cli/src/agent/__tests__/sessionTxConfirm.test.ts).
  it('pins the AlreadyProcessed branch: idempotent success, no re-broadcast, no hash verification', async () => {
    mocks.sendRawTransaction.mockRejectedValue(new Error('This transaction has already been processed'))

    await expect(broadcastSolanaTx({ chain: Chain.Solana, tx })).resolves.toBeUndefined()

    // Single broadcast attempt — the duplicate signature is NOT re-sent.
    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(1)
    // Resolved as success directly, not routed to the verify-by-hash fallback.
    expect(mocks.verifyBroadcastByHash).not.toHaveBeenCalled()
  })
})
