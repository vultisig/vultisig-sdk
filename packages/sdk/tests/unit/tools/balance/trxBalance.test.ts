import { afterEach, describe, expect, it, vi } from 'vitest'

import { getTrxBalance } from '@/tools/balance'

const address = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

afterEach(() => vi.unstubAllGlobals())

describe('TRX balance through the real TRON response parser', () => {
  it.each([
    ['9007199254740993', '9007199254.740993'],
    ['9007199254740991', '9007199254.740991'],
    ['9007199254740992', '9007199254.740992'],
    ['12500000', '12.5'],
    ['1', '0.000001'],
    ['0', '0'],
    ['18446744073709551615', '18446744073709.551615'],
  ])('preserves %s SUN', async (sun, trx) => {
    const fetch = vi.fn().mockImplementation(async () => new Response(`{"balance":${sun}}`))
    vi.stubGlobal('fetch', fetch)
    const result = await getTrxBalance(address)
    expect(result).toMatchObject({ address, balanceSunRaw: sun, balanceSun: Number(sun), balanceTrx: trx })
    // Preserve the public numeric type for existing TypeScript consumers.
    const numericMirror: number = result.balanceSun
    expect(typeof numericMirror).toBe('number')
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]).toEqual([
      expect.stringContaining('/wallet/getaccount'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ address, visible: true }) }),
    ])
  })

  it.each(['{}', '{"address":"account"}', '{"balance":0}'])('retains zero for %s', async text => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response(text))
    )
    await expect(getTrxBalance(address)).resolves.toMatchObject({ balanceSunRaw: '0', balanceSun: 0, balanceTrx: '0' })
  })

  it.each([
    '{"balance":125',
    '{"balance":125} trailing',
    '{"balance":1.5}',
    '{"balance":1e6}',
    '{"balance":-1}',
    '{"balance":-0}',
    '{"balance":01}',
    '{"balance":"125"}',
    '{"balance":null}',
    '{"balance":true}',
    '{"balance":{}}',
    '{"balance":[]}',
    '{"balance":1,"balance":2}',
    '{"balance":1,"balan\\u0063e":2}',
    '{"nested":{"balance":125}}',
    '{"address":"account","nested":{"balance":125}}',
    '{"address":"account","nested":[{"balance":125}]}',
    'null',
    '[]',
  ])('rejects invalid account balance %s', async text => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response(text))
    )
    await expect(getTrxBalance(address)).rejects.toThrow()
  })

  it('ignores nested and string-embedded balances and decodes escaped top-level keys', async () => {
    const text = '{"nested":[{"balance":2}],"account_name":"escaped \\"balance\\":3","balan\\u0063e":9007199254740993}'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(text)))
    await expect(getTrxBalance(address)).resolves.toMatchObject({
      balanceSunRaw: '9007199254740993',
      balanceTrx: '9007199254.740993',
    })
  })

  it('preserves exact fallback text after a malformed primary', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"balance":125'))
      .mockResolvedValueOnce(new Response('{"balance":9007199254740993}'))
    vi.stubGlobal('fetch', fetch)
    await expect(getTrxBalance(address)).resolves.toMatchObject({ balanceSunRaw: '9007199254740993' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
