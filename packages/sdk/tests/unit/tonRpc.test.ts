import { afterEach, describe, expect, it, vi } from 'vitest'

import { getTonWalletInfo } from '@/chains/ton/rpc'

function mockFetchByUrl(
  handlers: Record<string, { ok: boolean; status?: number; statusText?: string; json?: unknown }>
) {
  const fetchMock = vi.fn(async (url: string) => {
    const match = Object.keys(handlers).find(key => url.includes(key))
    if (!match) throw new Error(`unexpected fetch url in test: ${url}`)
    const handler = handlers[match]
    return {
      ok: handler.ok,
      status: handler.status ?? (handler.ok ? 200 : 500),
      statusText: handler.statusText ?? (handler.ok ? 'OK' : 'Internal Server Error'),
      json: async () => handler.json ?? {},
    }
  }) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('getTonWalletInfo', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('resolves seqno 0 / status uninit for a genuinely uninitialized wallet (legit first-send path)', async () => {
    mockFetchByUrl({
      getExtendedAddressInformation: {
        ok: true,
        // No `account_state` — the real toncenter shape for a wallet that has
        // received funds but never sent (contract not yet deployed).
        json: { result: { balance: '5000000' } },
      },
      addressInformation: {
        ok: true,
        json: { status: 'uninit', balance: '5000000' },
      },
    })

    await expect(getTonWalletInfo('EQuninit', 'https://gw.test')).resolves.toEqual({
      seqno: 0,
      balance: 5_000_000n,
      status: 'uninit',
    })
  })

  it('resolves the real seqno/status for an active wallet', async () => {
    mockFetchByUrl({
      getExtendedAddressInformation: {
        ok: true,
        json: { result: { account_state: { seqno: 12 }, balance: '9' } },
      },
      addressInformation: {
        ok: true,
        json: { status: 'active', balance: '9' },
      },
    })

    await expect(getTonWalletInfo('EQactive', 'https://gw.test')).resolves.toEqual({
      seqno: 12,
      balance: 9n,
      status: 'active',
    })
  })

  it('throws (does not default to uninit/seqno 0) on a non-OK getExtendedAddressInformation response', async () => {
    mockFetchByUrl({
      getExtendedAddressInformation: { ok: false, status: 503, statusText: 'Service Unavailable' },
      addressInformation: { ok: true, json: { status: 'active' } },
    })

    await expect(getTonWalletInfo('EQflaky', 'https://gw.test')).rejects.toThrow(/getExtendedAddressInformation failed/)
  })

  it('throws (does not default to uninit/seqno 0) on a non-OK addressInformation response', async () => {
    mockFetchByUrl({
      getExtendedAddressInformation: { ok: true, json: { result: { account_state: { seqno: 3 } } } },
      addressInformation: { ok: false, status: 500, statusText: 'Internal Server Error' },
    })

    await expect(getTonWalletInfo('EQflaky', 'https://gw.test')).rejects.toThrow(/addressInformation failed/)
  })

  it('throws (does not default to uninit/seqno 0) on a network-level fetch failure', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network unreachable')
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', fetchMock)

    await expect(getTonWalletInfo('EQflaky', 'https://gw.test')).rejects.toThrow(/network unreachable/)
  })
})
