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
})
