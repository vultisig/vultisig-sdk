import { beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('relays through standard RPC even when JITO accepts the transaction', async () => {
    await broadcastSolanaTx({ chain: Chain.Solana, tx })

    expect(mocks.sendJitoTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.sendRawTransaction).toHaveBeenCalledWith(expect.any(Uint8Array), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
  })

  it('falls back to standard RPC when JITO rejects the transaction', async () => {
    mocks.sendJitoTransaction.mockRejectedValue(new Error('jito unavailable'))

    await broadcastSolanaTx({ chain: Chain.Solana, tx })

    expect(mocks.sendJitoTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.sendRawTransaction).toHaveBeenCalledTimes(1)
  })

  it('verifies by hash when standard RPC rejects after JITO acceptance', async () => {
    const rpcError = new Error('already processed')
    mocks.sendRawTransaction.mockRejectedValue(rpcError)
    mocks.verifyBroadcastByHash.mockResolvedValue(undefined)

    await broadcastSolanaTx({ chain: Chain.Solana, tx })

    expect(mocks.verifyBroadcastByHash).toHaveBeenCalledWith({
      chain: Chain.Solana,
      tx,
      error: rpcError,
    })
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
