import { UtxoChain } from '@vultisig/core-chain/Chain'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatUtxoBalance, getUtxoBalance, supportedUtxoBalanceChains } from '../../src/tools/balance/utxoBalance'

const blockchairResponse = (balance: number | null) => ({
  ok: true,
  status: 200,
  json: async () => ({
    data: {
      '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa': { address: { balance } },
    },
  }),
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

    const result = await getUtxoBalance(UtxoChain.Bitcoin, '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')

    expect(result).toEqual({
      chain: UtxoChain.Bitcoin,
      address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
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
      .mockResolvedValue(blockchairResponse(500000000) as unknown as Response)

    const result = await getUtxoBalance(UtxoChain.BitcoinCash, 'qzm47qz5ue99y9yl4aca7jnz7dwgdenl85jkfx3znl')

    expect(result.symbol).toBe('BCH')
    expect(result.balance).toBe('5.00000000')
    const calledUrl = fetchSpy.mock.calls[0][0] as string
    expect(calledUrl).toContain('/bitcoin-cash/dashboards/address/')
  })

  it('treats a null balance as zero', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(blockchairResponse(null) as unknown as Response)
    const result = await getUtxoBalance(UtxoChain.Dogecoin, 'D7Y55fkjBjuyo8XBhTQH4Pe9X1zJSUg5pZ')
    expect(result.satoshis).toBe('0')
    expect(result.balance).toBe('0.00000000')
    expect(result.symbol).toBe('DOGE')
  })

  it('honours a custom blockchairBase override (proxy/mirror)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(blockchairResponse(1) as unknown as Response)
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
