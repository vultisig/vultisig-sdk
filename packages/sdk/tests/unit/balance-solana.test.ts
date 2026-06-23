import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSolBalance, getSplTokenBalance } from '@/tools/balance/solana'

const OWNER = 'GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ'
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

function mockRpc(result: unknown, ok = true, status = 200) {
  return vi.fn(
    async () =>
      ({
        ok,
        status,
        json: async () => ({ jsonrpc: '2.0', id: 1, result }),
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
    expect(res.sol).toBe('1.5')
    expect(res.address).toBe(OWNER)
    expect(typeof res.asOf).toBe('string')
  })

  it('returns "0" for a zero balance (no dangling decimal)', async () => {
    vi.stubGlobal('fetch', mockRpc({ value: 0 }))
    const res = await getSolBalance(OWNER)
    expect(res.sol).toBe('0')
  })

  it('preserves full lamport precision in the SOL string', async () => {
    vi.stubGlobal('fetch', mockRpc({ value: 1 }))
    const res = await getSolBalance(OWNER)
    expect(res.sol).toBe('0.000000001')
  })

  it('throws on a non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', mockRpc({}, false, 503))
    await expect(getSolBalance(OWNER)).rejects.toThrow(/HTTP 503/)
  })

  it('surfaces a JSON-RPC error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid param' } }),
          }) as unknown as Response
      )
    )
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
})
