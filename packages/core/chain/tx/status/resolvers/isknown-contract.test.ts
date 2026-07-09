import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSuiClient: vi.fn(),
  getTransactionBlock: vi.fn(),
  queryUrl: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/sui/client', () => ({
  getSuiClient: mocks.getSuiClient,
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

import { Chain, OtherChain } from '../../../Chain'
import { getBittensorTxStatus } from './bittensor'
import { getQbtcTxStatus } from './qbtc'
import { getSuiTxStatus } from './sui'
import { getTonTxStatus } from './ton'
import { getTronTxStatus } from './tron'

describe('status resolver isKnown contract', () => {
  const hash = '0x' + 'a'.repeat(64)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mocks.getSuiClient.mockReturnValue({
      getTransactionBlock: mocks.getTransactionBlock,
    })
  })

  it('marks Sui lookup failures and unknown hashes as not known', async () => {
    mocks.getTransactionBlock.mockRejectedValueOnce(new Error('not found'))
    await expect(getSuiTxStatus({ chain: OtherChain.Sui, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })

    mocks.getTransactionBlock.mockResolvedValueOnce(null)
    await expect(getSuiTxStatus({ chain: OtherChain.Sui, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
  })

  it('marks non-terminal Sui responses as known pending', async () => {
    mocks.getTransactionBlock.mockResolvedValueOnce({ effects: { status: { status: 'pending' } } })

    await expect(getSuiTxStatus({ chain: OtherChain.Sui, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: true,
    })
  })

  it('marks Ton lookup failures and empty transaction lists as not known', async () => {
    mocks.queryUrl.mockRejectedValueOnce(new Error('api down'))
    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })

    mocks.queryUrl.mockResolvedValueOnce({ transactions: [] })
    await expect(getTonTxStatus({ chain: OtherChain.Ton, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
  })

  it('marks Tron lookup failures and unknown hashes as not known', async () => {
    mocks.queryUrl.mockRejectedValueOnce(new Error('api down'))
    await expect(getTronTxStatus({ chain: OtherChain.Tron, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })

    mocks.queryUrl.mockResolvedValueOnce({})
    await expect(getTronTxStatus({ chain: OtherChain.Tron, hash })).resolves.toEqual({
      status: 'not_found',
      isKnown: false,
    })
  })

  it('marks indexed Tron responses without a terminal receipt as known pending', async () => {
    mocks.queryUrl.mockResolvedValueOnce({ id: hash, blockNumber: 0 })
    await expect(getTronTxStatus({ chain: OtherChain.Tron, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: true,
    })

    mocks.queryUrl.mockResolvedValueOnce({ id: hash, blockNumber: 123 })
    await expect(getTronTxStatus({ chain: OtherChain.Tron, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: true,
    })
  })

  it('marks Bittensor lookup failures and empty indexer results as not known', async () => {
    mocks.queryUrl.mockRejectedValueOnce(new Error('api down'))
    await expect(getBittensorTxStatus({ chain: OtherChain.Bittensor, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })

    mocks.queryUrl.mockResolvedValueOnce({ pagination: { page: 1, limit: 1, total: 0 }, data: [] })
    await expect(getBittensorTxStatus({ chain: OtherChain.Bittensor, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
  })

  it('marks QBTC lookup failures and missing tx responses as not known', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('api down')))
    await expect(getQbtcTxStatus({ chain: Chain.QBTC, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValueOnce({}),
      })
    )
    await expect(getQbtcTxStatus({ chain: Chain.QBTC, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
  })
})
