import { afterEach, describe, expect, it, vi } from 'vitest'

import { Chain } from '../../../Chain'
import { getQbtcTxStatus } from './qbtc'

const hash = 'A'.repeat(64)

const mockFetchResponse = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  })

describe('getQbtcTxStatus', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports not_found for the Cosmos LCD tx-not-found response', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse(404, {
        code: 5,
        message: `tx not found: ${hash}`,
        details: [],
      })
    )

    await expect(getQbtcTxStatus({ chain: Chain.QBTC, hash })).resolves.toEqual({
      status: 'not_found',
      isKnown: false,
    })
  })

  it('reports not_found for a Cosmos SDK RPC-prefixed tx-not-found response', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse(404, {
        code: 5,
        message: `rpc error: code = NotFound desc = tx not found: ${hash}`,
        details: [],
      })
    )

    await expect(getQbtcTxStatus({ chain: Chain.QBTC, hash })).resolves.toEqual({
      status: 'not_found',
      isKnown: false,
    })
  })

  it('keeps an unrelated HTTP 404/code 5 response pending', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse(404, {
        code: 5,
        message: 'account not found',
        details: [],
      })
    )

    await expect(getQbtcTxStatus({ chain: Chain.QBTC, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
  })

  it('keeps a non-not-found HTTP failure pending', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse(503, {
        code: 14,
        message: 'upstream unavailable',
        details: [],
      })
    )

    await expect(getQbtcTxStatus({ chain: Chain.QBTC, hash })).resolves.toEqual({
      status: 'pending',
      isKnown: false,
    })
  })

  it.each([
    [0, 'success'],
    [7, 'error'],
  ] as const)('reports tx_response code %s as %s', async (code, status) => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse(200, {
        tx_response: { code, txhash: hash, gas_used: '0', gas_wanted: '0' },
      })
    )

    await expect(getQbtcTxStatus({ chain: Chain.QBTC, hash })).resolves.toEqual({
      status,
      receipt: undefined,
    })
  })
})
