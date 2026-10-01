import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryUrl: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

import { OtherChain } from '../../../Chain'
import { cardanoApiUrl } from '../../../chains/cardano/client/config'
import { getCardanoTxStatus } from './cardano'

describe('getCardanoTxStatus', () => {
  const hash = 'e7ad963d4e6fae93296b664ac239e96134126f8b1fb4f8944709ed39ca44a3c1'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns success when Koios reports one or more confirmations', async () => {
    mocks.queryUrl.mockResolvedValue([{ tx_hash: hash, num_confirmations: 12 }])

    await expect(getCardanoTxStatus({ chain: OtherChain.Cardano, hash })).resolves.toEqual({ status: 'success' })

    expect(mocks.queryUrl).toHaveBeenCalledWith(`${cardanoApiUrl}/tx_status`, {
      body: { _tx_hashes: [hash] },
    })
    expect(mocks.queryUrl.mock.calls[0][0]).not.toContain('blockchair')
  })

  it('returns known pending when Koios has the transaction with zero confirmations', async () => {
    mocks.queryUrl.mockResolvedValue([{ tx_hash: hash, num_confirmations: 0 }])

    await expect(getCardanoTxStatus({ chain: OtherChain.Cardano, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: true,
    })
  })

  it('reports not_found when Koios returns null confirmations for the requested hash', async () => {
    mocks.queryUrl.mockResolvedValue([{ tx_hash: hash, num_confirmations: null }])

    await expect(getCardanoTxStatus({ chain: OtherChain.Cardano, hash })).resolves.toEqual({
      status: 'not_found',
      isKnown: false,
    })
  })

  it('reports not_found when a successful Koios response omits the requested hash', async () => {
    mocks.queryUrl.mockResolvedValue([{ tx_hash: 'different', num_confirmations: 3 }])

    await expect(getCardanoTxStatus({ chain: OtherChain.Cardano, hash })).resolves.toEqual({
      status: 'not_found',
      isKnown: false,
    })
  })

  it('reports not_found when Koios returns an empty array', async () => {
    mocks.queryUrl.mockResolvedValue([])

    await expect(getCardanoTxStatus({ chain: OtherChain.Cardano, hash })).resolves.toEqual({
      status: 'not_found',
      isKnown: false,
    })
  })

  it('returns unknown pending for a malformed response', async () => {
    mocks.queryUrl.mockResolvedValue({ tx_hash: hash, num_confirmations: 3 })

    await expect(getCardanoTxStatus({ chain: OtherChain.Cardano, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
  })

  it.each([
    ['null entry', [null]],
    ['entry without tx_hash', [{}]],
    ['entry with a non-string tx_hash', [{ tx_hash: 123, num_confirmations: 1 }]],
  ])('returns unknown pending for a malformed array %s', async (_case, response) => {
    mocks.queryUrl.mockResolvedValue(response)

    await expect(getCardanoTxStatus({ chain: OtherChain.Cardano, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
  })

  it('returns unknown pending when the Koios request fails', async () => {
    mocks.queryUrl.mockRejectedValue(new Error('provider unavailable'))

    await expect(getCardanoTxStatus({ chain: OtherChain.Cardano, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
  })

  it('returns unknown pending for an invalid negative confirmation count', async () => {
    mocks.queryUrl.mockResolvedValue([{ tx_hash: hash, num_confirmations: -1 }])

    await expect(getCardanoTxStatus({ chain: OtherChain.Cardano, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
  })

  it('returns unknown pending when the confirmation count has the wrong type', async () => {
    mocks.queryUrl.mockResolvedValue([{ tx_hash: hash, num_confirmations: '3' }])

    await expect(getCardanoTxStatus({ chain: OtherChain.Cardano, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
  })
})
