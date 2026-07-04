import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSignatureStatuses: vi.fn(),
  getTransaction: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/solana/client', () => ({
  getSolanaClient: () => ({
    getSignatureStatuses: mocks.getSignatureStatuses,
    getTransaction: mocks.getTransaction,
  }),
}))

import { Chain } from '../../../Chain'
import { getSolanaTxStatus } from './solana'

describe('getSolanaTxStatus', () => {
  const hash = '2gB3ifNe2kSoJEYoVY7T4vw2z5ci9nL6WcQQuCC2ozCiURBwSfC9uGcCq9CS2pAzX7ed1xwyS4434BmSg2WhrZ7j'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks missing signatures as unknown pending', async () => {
    mocks.getSignatureStatuses.mockResolvedValue({ value: [null] })

    await expect(getSolanaTxStatus({ chain: Chain.Solana, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
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
})
