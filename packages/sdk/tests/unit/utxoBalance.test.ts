import { createServer } from 'node:http'

import { UtxoChain } from '@vultisig/core-chain/Chain'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatUtxoBalance, getUtxoBalance, supportedUtxoBalanceChains } from '../../src/tools/balance/utxoBalance'

const bitcoinAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
const dogecoinAddress = 'D7Y55fkjBjuyo8XBhTQH4Pe9X1zJSUg5pZ'

const blockchairResponse = (balance: number | null, address = bitcoinAddress) => {
  const body = JSON.stringify({
    context: { code: 200 },
    data: {
      [address]: { address: { balance, balance_usd: 0 } },
    },
  })
  return {
    ok: true,
    status: 200,
    text: async () => body,
    json: async () => JSON.parse(body),
  }
}

// Raw-body helper for high-precision cases where the balance integer exceeds
// Number.MAX_SAFE_INTEGER and must NOT round-trip through a JS number.
const blockchairRawResponse = (rawBody: string) => ({
  ok: true,
  status: 200,
  text: async () => rawBody,
  json: async () => JSON.parse(rawBody),
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('formatUtxoBalance', () => {
  it('formats satoshis to 8 decimals without float precision loss', () => {
    expect(formatUtxoBalance(6824924n)).toBe('0.06824924')
    expect(formatUtxoBalance(100000000n)).toBe('1.00000000')
    expect(formatUtxoBalance(0n)).toBe('0.00000000')
    // 21M BTC in sats — well beyond Number.MAX_SAFE_INTEGER for the sub-unit math
    expect(formatUtxoBalance(2100000000000000n)).toBe('21000000.00000000')
  })

  it('handles negative amounts', () => {
    expect(formatUtxoBalance(-12345678n)).toBe('-0.12345678')
  })
})

describe('getUtxoBalance', () => {
  it('reads a balance and returns satoshis + human string + ticker', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(blockchairResponse(6824924) as unknown as Response)

    const result = await getUtxoBalance(UtxoChain.Bitcoin, bitcoinAddress)

    expect(result).toEqual({
      chain: UtxoChain.Bitcoin,
      address: bitcoinAddress,
      symbol: 'BTC',
      satoshis: '6824924',
      balance: '0.06824924',
    })
    expect(fetchSpy).toHaveBeenCalledOnce()
    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toBe(
      'https://api.vultisig.com/blockchair/bitcoin/dashboards/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
    )
  })

  it('uses the hyphenated Blockchair path for Bitcoin-Cash', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        blockchairResponse(500000000, 'qzm47qz5ue99y9yl4aca7jnz7dwgdenl85jkfx3znl') as unknown as Response
      )

    const result = await getUtxoBalance(UtxoChain.BitcoinCash, 'qzm47qz5ue99y9yl4aca7jnz7dwgdenl85jkfx3znl')

    expect(result.symbol).toBe('BCH')
    expect(result.balance).toBe('5.00000000')
    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toContain('/bitcoin-cash/dashboards/address/')
  })

  it('treats a null balance as zero', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(blockchairResponse(null, dogecoinAddress) as unknown as Response)
    const result = await getUtxoBalance(UtxoChain.Dogecoin, dogecoinAddress)
    expect(result.satoshis).toBe('0')
    expect(result.balance).toBe('0.00000000')
    expect(result.symbol).toBe('DOGE')
  })

  it('preserves satoshi precision past Number.MAX_SAFE_INTEGER (DOGE whale)', async () => {
    // 3e18 base units = 30B DOGE. Number.MAX_SAFE_INTEGER is ~9.0e15, so the
    // last digits would be lost if the balance round-tripped through a JS
    // number. The +1 on the last digit is the canary: BigInt(3000000000000000001)
    // off a parsed number would collapse to ...000.
    const big = '3000000000000000001'
    const rawBody = JSON.stringify({
      data: {
        D7Y55fkjBjuyo8XBhTQH4Pe9X1zJSUg5pZ: {
          // balance_usd float deliberately present BEFORE we rely on the regex
          // scoping to the integer `balance` inside the `address` object.
          address: { type: null, balance: 0, balance_usd: 1.23 },
        },
      },
      // overwrite the placeholder integer with the un-numberifiable one; the
      // raw text is what the extractor reads.
    }).replace('"balance":0', `"balance":${big}`)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(blockchairRawResponse(rawBody) as unknown as Response)

    const result = await getUtxoBalance(UtxoChain.Dogecoin, dogecoinAddress)
    expect(result.satoshis).toBe(big)
    expect(result.balance).toBe('30000000000.00000001')
  })

  it('does not pick up balance_usd or per-utxo values', async () => {
    // balance_usd appears first lexically inside the address object in some
    // shapes; ensure the extractor still grabs the integer satoshi balance.
    const rawBody = `{"data":{"${bitcoinAddress}":{"address":{"balance":123456,"balance_usd":999999.99},"utxo":[{"value":777}]}}}`
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(blockchairRawResponse(rawBody) as unknown as Response)
    const result = await getUtxoBalance(UtxoChain.Bitcoin, bitcoinAddress)
    expect(result.satoshis).toBe('123456')
  })

  it.each([
    ['missing data', '{}'],
    ['null data', '{"data":null}'],
    ['missing requested address', '{"data":{}}'],
    ['wrong address', '{"data":{"other":{"address":{"balance":42}}}}'],
    ['missing address record', '{"data":{"test":{}}}'],
    ['missing balance', '{"data":{"test":{"address":{}}}}'],
  ])('rejects %s instead of returning zero', async (_caseName, rawBody) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(blockchairRawResponse(rawBody) as unknown as Response)
    await expect(getUtxoBalance(UtxoChain.Bitcoin, 'test')).rejects.toThrow(/invalid Blockchair response/i)
  })

  it('rejects a provider error in an HTTP-200 response', async () => {
    const rawBody = '{"context":{"code":429,"error":"Rate limit exceeded"},"data":null}'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(blockchairRawResponse(rawBody) as unknown as Response)
    await expect(getUtxoBalance(UtxoChain.Bitcoin, 'test')).rejects.toThrow(/provider error.*429/i)
  })

  it.each([
    '{"context":{"code":429,"code":200},"data":{"test":{"address":{"balance":123}}}}',
    '{"context":{"code":429,"error":"Rate limit exceeded"},"context":{"code":200},"data":{"test":{"address":{"balance":123}}}}',
    '{"context":{"code":200,"error":"Rate limit exceeded","err\\u006fr":""},"data":{"test":{"address":{"balance":123}}}}',
  ])('rejects duplicate provider-status keys instead of applying last-key-wins', async rawBody => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(blockchairRawResponse(rawBody) as unknown as Response)
    await expect(getUtxoBalance(UtxoChain.Bitcoin, 'test')).rejects.toThrow(/duplicate JSON property/i)
  })

  it.each(['1e8', '1.5', '-1', '"123"', '{}', 'true'])('rejects unsupported balance token %s', async token => {
    const rawBody = `{"data":{"test":{"address":{"balance":${token}}}}}`
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(blockchairRawResponse(rawBody) as unknown as Response)
    await expect(getUtxoBalance(UtxoChain.Bitcoin, 'test')).rejects.toThrow(/plain nonnegative integer or null/i)
  })

  it.each([
    ['0', '0', '0.00000000'],
    ['null', '0', '0.00000000'],
    ['9007199254740993', '9007199254740993', '90071992.54740993'],
    ['3000000000000000001', '3000000000000000001', '30000000000.00000001'],
  ])('preserves valid balance token %s', async (token, expectedSatoshis, expectedBalance) => {
    const rawBody = `{"data":{"test":{"address":{"balance":${token}}}}}`
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(blockchairRawResponse(rawBody) as unknown as Response)
    const result = await getUtxoBalance(UtxoChain.Bitcoin, 'test')
    expect(result.satoshis).toBe(expectedSatoshis)
    expect(result.balance).toBe(expectedBalance)
  })

  it('selects only the requested address and follows escaped JSON keys', async () => {
    const rawBody =
      '{"decoy":{"address":{"balance":999}},"data":{"other":{"address":{"balance":42}},"te\\u0073t":{"address":{"balance":123}}}}'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(blockchairRawResponse(rawBody) as unknown as Response)
    const result = await getUtxoBalance(UtxoChain.Bitcoin, 'test')
    expect(result.satoshis).toBe('123')
  })

  it('rejects duplicate path keys, including escaped aliases', async () => {
    const rawBody = '{"data":{"test":{"address":{"balance":123}},"te\\u0073t":{"address":{"balance":999}}}}'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(blockchairRawResponse(rawBody) as unknown as Response)
    await expect(getUtxoBalance(UtxoChain.Bitcoin, 'test')).rejects.toThrow(/duplicate JSON property/i)
  })

  it('enforces response validation and timeouts through the real HTTP boundary', async () => {
    const responseBodies: Record<string, string> = {
      missing: '{"data":{}}',
      providerError: '{"context":{"code":429,"error":"Rate limit exceeded"},"data":null}',
      exponent: '{"data":{"exponent":{"address":{"balance":1e8}}}}',
      wrongAddress: '{"data":{"other":{"address":{"balance":42}}}}',
      zero: '{"data":{"zero":{"address":{"balance":0}}}}',
      large: '{"data":{"large":{"address":{"balance":3000000000000000001}}}}',
    }
    const server = createServer((request, response) => {
      const requestAddress = decodeURIComponent(request.url?.split('/').at(-1) ?? '')
      response.writeHead(200, { 'content-type': 'application/json' })
      if (requestAddress === 'slow') {
        setTimeout(() => response.end('{"data":{"slow":{"address":{"balance":1}}}}'), 100).unref()
        return
      }
      response.end(responseBodies[requestAddress] ?? '{}')
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const serverAddress = server.address()
    if (!serverAddress || typeof serverAddress === 'string') throw new Error('Expected a TCP test server address')
    const blockchairBase = `http://127.0.0.1:${serverAddress.port}`

    try {
      await expect(getUtxoBalance(UtxoChain.Bitcoin, 'missing', { blockchairBase })).rejects.toThrow(
        /missing requested address/i
      )
      await expect(getUtxoBalance(UtxoChain.Bitcoin, 'providerError', { blockchairBase })).rejects.toThrow(
        /provider error/i
      )
      await expect(getUtxoBalance(UtxoChain.Bitcoin, 'exponent', { blockchairBase })).rejects.toThrow(
        /plain nonnegative integer/i
      )
      await expect(getUtxoBalance(UtxoChain.Bitcoin, 'wrongAddress', { blockchairBase })).rejects.toThrow(
        /missing requested address/i
      )

      await expect(getUtxoBalance(UtxoChain.Bitcoin, 'zero', { blockchairBase })).resolves.toMatchObject({
        satoshis: '0',
        balance: '0.00000000',
      })
      await expect(getUtxoBalance(UtxoChain.Bitcoin, 'large', { blockchairBase })).resolves.toMatchObject({
        satoshis: '3000000000000000001',
        balance: '30000000000.00000001',
      })
      await expect(getUtxoBalance(UtxoChain.Bitcoin, 'slow', { blockchairBase, timeoutMs: 10 })).rejects.toThrow()
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('throws on a non-JSON 200 body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html>rate limited</html>',
    } as unknown as Response)
    await expect(getUtxoBalance(UtxoChain.Bitcoin, bitcoinAddress)).rejects.toThrow(/non-JSON/i)
  })

  it('honours a custom blockchairBase override (proxy/mirror)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(blockchairResponse(1, 'ltc1qexampleaddress') as unknown as Response)
    await getUtxoBalance(UtxoChain.Litecoin, 'ltc1qexampleaddress', {
      blockchairBase: 'https://proxy.example/blockchair/',
    })
    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toBe('https://proxy.example/blockchair/litecoin/dashboards/address/ltc1qexampleaddress')
  })

  it('rejects unsupported chains (e.g. Zcash, out of scope)', async () => {
    await expect(getUtxoBalance(UtxoChain.Zcash, 't1exampleaddr')).rejects.toThrow(/unsupported chain/i)
  })

  it('rejects an empty address', async () => {
    await expect(getUtxoBalance(UtxoChain.Bitcoin, '')).rejects.toThrow(/address is required/i)
  })

  it('throws on a non-OK HTTP response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 502 } as unknown as Response)
    await expect(getUtxoBalance(UtxoChain.Dash, 'XexampleDashAddr')).rejects.toThrow(/502/)
  })

  it('covers all 5 in-scope chains', () => {
    expect([...supportedUtxoBalanceChains]).toEqual([
      UtxoChain.Bitcoin,
      UtxoChain.Litecoin,
      UtxoChain.Dogecoin,
      UtxoChain.BitcoinCash,
      UtxoChain.Dash,
    ])
  })
})
