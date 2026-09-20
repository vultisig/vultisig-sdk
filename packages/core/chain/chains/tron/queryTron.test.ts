import { afterEach, describe, expect, it, vi } from 'vitest'

import { tronGridUrl, tronPublicRpcUrl, tronRpcUrl } from './config'
import { broadcastTronTransaction, queryTron } from './queryTron'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const hash = 'ab'.repeat(32)
const body = { raw_data_hex: '00', signature: ['signed'] }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Tron default routing', () => {
  it('uses only the primary on success and preserves request body', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ balance: 42 }))
    vi.stubGlobal('fetch', fetch)
    await expect(queryTron('/wallet/getaccount', { body: { address: 'address', visible: true } })).resolves.toEqual({
      balance: 42,
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      `${tronRpcUrl}/wallet/getaccount`,
      expect.objectContaining({ body: JSON.stringify({ address: 'address', visible: true }) })
    )
  })

  it.each([408, 429, 500, 502, 503, 504])('falls back on HTTP %s', async status => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ message: 'unavailable' }, status))
      .mockResolvedValueOnce(json({ balance: 42 }))
    vi.stubGlobal('fetch', fetch)
    await expect(queryTron('/wallet/getaccount')).resolves.toEqual({ balance: 42 })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${tronRpcUrl}/wallet/getaccount`,
      `${tronPublicRpcUrl}/wallet/getaccount`,
    ])
  })

  it('routes JSON-RPC fallback to TronGrid with the identical payload', async () => {
    const payload = { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [] }
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json({ jsonrpc: '2.0', id: 1, result: '0x1' }))
    vi.stubGlobal('fetch', fetch)
    await expect(queryTron('/jsonrpc', { body: payload })).resolves.toMatchObject({ result: '0x1' })
    expect(fetch.mock.calls[1]).toEqual([
      `${tronGridUrl}/jsonrpc`,
      expect.objectContaining({ body: JSON.stringify(payload) }),
    ])
  })

  it('throws when both providers fail', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetch)
    await expect(queryTron('/wallet/getaccount')).rejects.toThrow('fetch failed')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each([400, 401, 403, 404])('does not retry deterministic HTTP %s', async status => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ message: 'rejected' }, status))
    vi.stubGlobal('fetch', fetch)
    await expect(queryTron('/wallet/getaccount')).rejects.toThrow()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([{ Error: 'invalid address' }, { error: { code: -32000, message: 'execution reverted' } }])(
    'preserves node errors without fallback: %j',
    async response => {
      const fetch = vi.fn().mockResolvedValueOnce(json(response))
      vi.stubGlobal('fetch', fetch)
      await expect(queryTron('/jsonrpc')).rejects.toThrow('rejected request')
      expect(fetch).toHaveBeenCalledOnce()
    }
  )

  it('preserves contract rejection and legitimate empty account/transaction responses', async () => {
    const response = { result: { result: false, code: 'CONTRACT_VALIDATE_ERROR' } }
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(response))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({}))
    vi.stubGlobal('fetch', fetch)
    await expect(queryTron('/wallet/triggerconstantcontract')).resolves.toEqual(response)
    await expect(queryTron('/wallet/getaccount')).resolves.toEqual({})
    await expect(queryTron('/wallet/gettransactionbyid')).resolves.toEqual({})
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it.each([() => new Response('<html>unavailable</html>'), () => json(null), () => json({})])(
    'falls back on malformed JSON-RPC availability responses',
    async response => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(json({ result: '0x1' }))
      vi.stubGlobal('fetch', fetch)
      await expect(queryTron('/jsonrpc')).resolves.toEqual({ result: '0x1' })
      expect(fetch).toHaveBeenCalledTimes(2)
    }
  )

  it.each([
    '/wallet/getaccount',
    '/wallet/getaccountresource',
    '/wallet/gettransactionbyid',
    '/wallet/gettransactioninfobyid',
  ])('rejects nonempty malformed REST %s without manufacturing absent data', async path => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(json({ message: 'Service unavailable' })))
    vi.stubGlobal('fetch', fetch)
    await expect(queryTron(path)).rejects.toThrow('unrecognized response')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('uses valid fallback account data after a malformed primary response', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ message: 'Service unavailable' }))
      .mockResolvedValueOnce(json({ balance: 42 }))
    vi.stubGlobal('fetch', fetch)
    await expect(queryTron('/wallet/getaccount')).resolves.toEqual({ balance: 42 })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('honors a caller endpoint without silently falling back to mainnet', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetch)
    await expect(queryTron('/wallet/getaccount', {}, { primaryUrl: 'https://caller.example/' })).rejects.toThrow(
      'offline'
    )
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0][0]).toBe('https://caller.example/wallet/getaccount')
  })

  it('bounds a stalled response body and falls back without AbortSignal.timeout', async () => {
    vi.useFakeTimers()
    const fetch = vi
      .fn()
      .mockImplementationOnce((_url, { signal }) =>
        Promise.resolve({
          ok: true,
          json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
        })
      )
      .mockResolvedValueOnce(json({ balance: 42 }))
    vi.stubGlobal('fetch', fetch)
    const result = queryTron('/wallet/getaccount', { timeoutMs: 10 })
    await vi.advanceTimersByTimeAsync(11)
    await expect(result).resolves.toEqual({ balance: 42 })
  })
})

describe('Tron broadcast replay safety', () => {
  it('never submits through the generic read helper', async () => {
    await expect(queryTron('/wallet/broadcasttransaction', { body })).rejects.toThrow('Use broadcastTronTransaction')
  })

  it('checks both nodes before resubmitting identical bytes once', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('lost response'))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ result: true, txid: hash }))
    vi.stubGlobal('fetch', fetch)
    await expect(broadcastTronTransaction(body, hash)).resolves.toMatchObject({ txid: hash })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${tronRpcUrl}/wallet/broadcasttransaction`,
      `${tronRpcUrl}/wallet/gettransactionbyid`,
      `${tronPublicRpcUrl}/wallet/gettransactionbyid`,
      `${tronPublicRpcUrl}/wallet/broadcasttransaction`,
    ])
    expect(fetch.mock.calls[3][1].body).toBe(fetch.mock.calls[0][1].body)
  })

  it.each([0, 1])('requires status verification when provider %s already knows the hash', async provider => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('lost response'))
    if (provider) fetch.mockResolvedValueOnce(json({}))
    fetch.mockResolvedValueOnce(json({ txID: hash.toUpperCase() }))
    vi.stubGlobal('fetch', fetch)
    await expect(broadcastTronTransaction(body, hash)).resolves.toEqual({
      result: false,
      code: 'DUP_TRANSACTION_ERROR',
    })
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/broadcasttransaction'))).toHaveLength(1)
  })

  it.each([
    () => Promise.reject(new TypeError('offline')),
    () => Promise.resolve(json({ txID: 'cd'.repeat(32) })),
    () => Promise.resolve(json({ Error: 'invalid hash' })),
  ])('does not replay when absence cannot be established', async lookup => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('lost response'))
      .mockImplementationOnce(lookup)
      .mockImplementationOnce(lookup)
    vi.stubGlobal('fetch', fetch)
    await expect(broadcastTronTransaction(body, hash)).rejects.toThrow()
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/broadcasttransaction'))).toHaveLength(1)
  })

  it('recovers a complete primary outage only after public hash lookup', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ result: true, txid: hash }))
    vi.stubGlobal('fetch', fetch)
    await expect(broadcastTronTransaction(body, hash)).resolves.toMatchObject({ txid: hash })
    expect(fetch.mock.calls[2][0]).toBe(`${tronPublicRpcUrl}/wallet/gettransactionbyid`)
    expect(fetch.mock.calls[3][1].body).toBe(fetch.mock.calls[0][1].body)
  })

  it('does not retry an explicit submission rejection', async () => {
    const response = { result: false, code: 'CONTRACT_VALIDATE_ERROR' }
    const fetch = vi.fn().mockResolvedValueOnce(json(response))
    vi.stubGlobal('fetch', fetch)
    await expect(broadcastTronTransaction(body, hash)).resolves.toEqual(response)
    expect(fetch).toHaveBeenCalledOnce()
  })
})
