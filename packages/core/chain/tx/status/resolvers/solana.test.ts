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
})
