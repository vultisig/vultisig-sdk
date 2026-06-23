import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSolBalance, getSplTokenBalance } from '@/tools/balance/solana'

const OWNER = 'GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ'
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

function mockRpc(result: unknown, ok = true, status = 200) {
  return vi.fn(async () => {
    const body = { jsonrpc: '2.0', id: 1, result }
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response
  })
}

/** Mock that returns a hand-crafted raw response body verbatim (to exercise lossless u64 parsing). */
function mockRpcRaw(rawBody: string, ok = true, status = 200) {
  return vi.fn(
    async () =>
      ({
        ok,
        status,
        json: async () => JSON.parse(rawBody),
        text: async () => rawBody,
      }) as unknown as Response
  )
}

describe('getSolBalance', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('converts lamports to a trimmed SOL string', async () => {
    vi.stubGlobal('fetch', mockRpc({ value: 1_500_000_000 }))
    const res = await getSolBalance(OWNER)
    expect(res.lamports).toBe(1_500_000_000)
    expect(res.lamportsRaw).toBe('1500000000')
    expect(res.sol).toBe('1.5')
    expect(res.address).toBe(OWNER)
    expect(typeof res.asOf).toBe('string')
  })

  it('returns "0" for a zero balance (no dangling decimal)', async () => {
    vi.stubGlobal('fetch', mockRpc({ value: 0 }))
    const res = await getSolBalance(OWNER)
    expect(res.sol).toBe('0')
    expect(res.lamportsRaw).toBe('0')
  })

  it('preserves full lamport precision in the SOL string', async () => {
    vi.stubGlobal('fetch', mockRpc({ value: 1 }))
    const res = await getSolBalance(OWNER)
    expect(res.sol).toBe('0.000000001')
    expect(res.lamportsRaw).toBe('1')
  })

  it('preserves exact u64 lamports above Number.MAX_SAFE_INTEGER (no float corruption)', async () => {
    // 12345678901234567 lamports > 2^53; JSON.parse alone rounds this to ...568.
    vi.stubGlobal(
      'fetch',
      mockRpcRaw('{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":1},"value":12345678901234567}}')
    )
    const res = await getSolBalance(OWNER)
    // Lossless raw + exact integer-math SOL string (mirrors Go FormatLamports).
    expect(res.lamportsRaw).toBe('12345678901234567')
    expect(res.sol).toBe('12345678.901234567')
  })

  it('throws on a malformed getBalance response (no value)', async () => {
    vi.stubGlobal('fetch', mockRpcRaw('{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":1}}}'))
    await expect(getSolBalance(OWNER)).rejects.toThrow(/malformed/)
  })

  it('throws on a non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', mockRpc({}, false, 503))
    await expect(getSolBalance(OWNER)).rejects.toThrow(/HTTP 503/)
  })

  it('surfaces a JSON-RPC error', async () => {
    vi.stubGlobal('fetch', mockRpcRaw('{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Invalid param"}}'))
    await expect(getSolBalance(OWNER)).rejects.toThrow(/Invalid param/)
  })
})

describe('getSplTokenBalance', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses the token account, program and amount', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpc({
        value: [
          {
            pubkey: 'AtaPubkey1111111111111111111111111111111111',
            account: {
              data: {
                parsed: {
                  info: {
                    tokenAmount: { amount: '123456', decimals: 6 },
                    mint: USDC_MINT,
                  },
                  type: 'account',
                },
                program: 'spl-token',
              },
            },
          },
        ],
      })
    )
    const res = await getSplTokenBalance(OWNER, USDC_MINT)
    expect(res.balance).toBe('123456')
    expect(res.decimals).toBe(6)
    expect(res.tokenProgram).toBe('spl-token')
    expect(res.ata).toBe('AtaPubkey1111111111111111111111111111111111')
    expect(res.mint).toBe(USDC_MINT)
  })

  it('returns an empty zero balance when the owner holds no account for the mint', async () => {
    vi.stubGlobal('fetch', mockRpc({ value: [] }))
    const res = await getSplTokenBalance(OWNER, USDC_MINT)
    expect(res.balance).toBe('0')
    expect(res.decimals).toBe(0)
    expect(res.ata).toBe('')
    expect(res.tokenProgram).toBe('')
  })

  const splAcc = (
    pubkey: string,
    amount: string,
    opts: { mint?: string; decimals?: number; program?: string } = {}
  ) => ({
    pubkey,
    account: {
      data: {
        parsed: {
          info: {
            tokenAmount: { amount, decimals: opts.decimals ?? 6 },
            mint: opts.mint ?? USDC_MINT,
          },
          type: 'account',
        },
        program: opts.program ?? 'spl-token',
      },
    },
  })

  it('sums the balance across multiple token accounts for the same mint (lossless)', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpc({
        value: [
          splAcc('Aux1111111111111111111111111111111111111111', '100'),
          splAcc('AtaBiggest11111111111111111111111111111111', '18446744073709551615'), // u64 max
          splAcc('Aux2222222222222222222222222222222222222222', '1'),
        ],
      })
    )
    const res = await getSplTokenBalance(OWNER, USDC_MINT)
    // 100 + (2^64-1) + 1 = 18446744073709551716 (exceeds Number range; must stay exact)
    expect(res.balance).toBe('18446744073709551716')
    // Representative ATA = largest-balance account.
    expect(res.ata).toBe('AtaBiggest11111111111111111111111111111111')
    expect(res.decimals).toBe(6)
  })

  it('ignores accounts whose parsed mint does not match the requested mint', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpc({
        value: [
          splAcc('Legit11111111111111111111111111111111111111', '500'),
          splAcc('Spoof11111111111111111111111111111111111111', '999999', {
            mint: 'So11111111111111111111111111111111111111112',
          }),
        ],
      })
    )
    const res = await getSplTokenBalance(OWNER, USDC_MINT)
    expect(res.balance).toBe('500')
    expect(res.ata).toBe('Legit11111111111111111111111111111111111111')
  })
})
