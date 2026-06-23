import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the folder-local fetch helper so every test exercises the pure
// decode/parse/format/validate logic without a live network call.
const mockFetchJson = vi.fn()
vi.mock('@/tools/balance/rpc', async () => {
  const actual = await vi.importActual<typeof import('@/tools/balance/rpc')>('@/tools/balance/rpc')
  return {
    ...actual,
    fetchJson: (...args: unknown[]) => mockFetchJson(...args),
  }
})

import {
  formatBalance,
  getCardanoBalance,
  getSuiAllBalances,
  getSuiBalance,
  getTaoBalance,
  getTonBalance,
  getTrc20TokenBalance,
  getTrxBalance,
  getXrpBalance,
} from '@/tools/balance'
import { decodeBittensorAddress } from '@/tools/balance/bittensor'

// Real public-known test addresses (format-valid; no funds asserted).
const TAO_ADDR = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY' // Alice (SS58 prefix 42)
const DOT_ADDR = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5' // Polkadot prefix 0
const TRON_ADDR = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const SUI_ADDR = '0x0000000000000000000000000000000000000000000000000000000000000abc'

describe('formatBalance', () => {
  it('trims trailing zeros', () => {
    expect(formatBalance(1_500_000n, 6)).toBe('1.5')
    expect(formatBalance(1_000_000n, 6)).toBe('1')
    expect(formatBalance(0n, 6)).toBe('0')
    expect(formatBalance(1n, 9)).toBe('0.000000001')
  })
})

describe('decodeBittensorAddress (fund-safety)', () => {
  it('accepts a valid Bittensor SS58 address and returns 32-byte pubkey', () => {
    const pk = decodeBittensorAddress(TAO_ADDR)
    expect(pk).toBeInstanceOf(Uint8Array)
    expect(pk.length).toBe(32)
  })

  it('rejects a Polkadot address (prefix 0) — shared AccountId encoding', () => {
    expect(() => decodeBittensorAddress(DOT_ADDR)).toThrow(/prefix/i)
  })

  it('rejects garbage', () => {
    expect(() => decodeBittensorAddress('not-an-address')).toThrow()
  })
})

describe('getXrpBalance', () => {
  beforeEach(() => mockFetchJson.mockReset())

  it('parses funded balance from drops', async () => {
    mockFetchJson.mockResolvedValueOnce({
      result: { account_data: { Balance: '25000000' } },
    })
    const r = await getXrpBalance('rXYZ')
    expect(r.balanceDrops).toBe('25000000')
    expect(r.balanceXrp).toBe('25.000000')
  })

  it('keeps full precision for a >2^53-drop balance (no Number() rounding)', async () => {
    // 90,000,000,000.123456 XRP = 90000000000123456 drops > 2^53 (9.007e15).
    // A Number() round-trip would corrupt this to ...3460 — assert it does not.
    const raw = '90000000000123456'
    mockFetchJson.mockResolvedValueOnce({
      result: { account_data: { Balance: raw } },
    })
    const r = await getXrpBalance('rXYZ')
    expect(r.balanceDrops).toBe(raw)
    expect(r.balanceXrp).toBe('90000000000.123456')
    // Guard: the lossy path would have produced these.
    expect(r.balanceDrops).not.toBe(String(Number(raw)))
  })

  it('rejects a non-integer Balance instead of silently NaN-ing', async () => {
    mockFetchJson.mockResolvedValueOnce({
      result: { account_data: { Balance: 'not-a-number' } },
    })
    await expect(getXrpBalance('rXYZ')).rejects.toThrow(/non-integer Balance/)
  })

  it('treats actNotFound as unfunded zero, not an error', async () => {
    mockFetchJson.mockResolvedValueOnce({ result: { error: 'actNotFound' } })
    const r = await getXrpBalance('rXYZ')
    expect(r.balanceDrops).toBe('0')
    expect(r.balanceXrp).toBe('0.000000')
    expect(r.note).toMatch(/unfunded/i)
  })

  it('surfaces a malformed-address XRPL error instead of "0 XRP"', async () => {
    mockFetchJson.mockResolvedValueOnce({
      result: { error: 'actMalformed', error_message: 'Account malformed.' },
    })
    await expect(getXrpBalance('garbage')).rejects.toThrow(/actMalformed/)
  })
})

describe('getTrxBalance', () => {
  beforeEach(() => mockFetchJson.mockReset())

  it('formats SUN into TRX', async () => {
    mockFetchJson.mockResolvedValueOnce({ balance: 12_500_000 })
    const r = await getTrxBalance(TRON_ADDR)
    expect(r.balanceSun).toBe(12_500_000)
    expect(r.balanceTrx).toBe('12.5')
  })

  it('rejects a non-Tron address before any RPC call', async () => {
    await expect(getTrxBalance('0xdeadbeef')).rejects.toThrow(/not a valid Tron address/)
    expect(mockFetchJson).not.toHaveBeenCalled()
  })
})

describe('getTrc20TokenBalance', () => {
  beforeEach(() => mockFetchJson.mockReset())

  it('decodes balanceOf / decimals / symbol from hex constant_result', async () => {
    // balanceOf -> 1_000_000 (0xf4240), decimals -> 6, symbol -> "USDT"
    mockFetchJson
      .mockResolvedValueOnce({ constant_result: ['00000000000000000000000000000000000000000000000000000000000f4240'] })
      .mockResolvedValueOnce({ constant_result: ['0000000000000000000000000000000000000000000000000000000000000006'] })
      .mockResolvedValueOnce({
        constant_result: [
          '0000000000000000000000000000000000000000000000000000000000000020' + // offset
            '0000000000000000000000000000000000000000000000000000000000000004' + // length 4
            '5553445400000000000000000000000000000000000000000000000000000000', // "USDT"
        ],
      })
    const r = await getTrc20TokenBalance(TRON_ADDR, TRON_ADDR)
    expect(r.balance).toBe('1000000')
    expect(r.decimals).toBe(6)
    expect(r.symbol).toBe('USDT')
  })
})

describe('getTonBalance', () => {
  beforeEach(() => mockFetchJson.mockReset())

  it('maps account_state and formats nanotons', async () => {
    mockFetchJson.mockResolvedValueOnce({
      result: { balance: '2500000000', account_state: { seqno: 7, '@type': 'raw.accountState' } },
    })
    const r = await getTonBalance('EQabc')
    expect(r.balance).toBe('2.5')
    expect(r.status).toBe('active')
    expect(r.seqno).toBe(7)
  })
})

describe('getSuiBalance / getSuiAllBalances', () => {
  beforeEach(() => mockFetchJson.mockReset())

  it('formats native SUI mist', async () => {
    mockFetchJson.mockResolvedValueOnce({ result: { totalBalance: '3000000000' } })
    const r = await getSuiBalance(SUI_ADDR)
    expect(r.balance).toBe('3')
    expect(r.balanceMist).toBe('3000000000')
  })

  it('flags native vs token and drops zero holdings', async () => {
    mockFetchJson.mockResolvedValueOnce({
      result: [
        { coinType: '0x2::sui::SUI', totalBalance: '1000000000', coinObjectCount: 1 },
        { coinType: '0xabc::usdc::USDC', totalBalance: '5000000', coinObjectCount: 1 },
        { coinType: '0xdef::dust::DUST', totalBalance: '0', coinObjectCount: 1 },
      ],
    })
    const r = await getSuiAllBalances(SUI_ADDR)
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('expected ok')
    expect(r.balances).toHaveLength(2)
    expect(r.balances[0]).toMatchObject({ ticker: 'SUI', isNative: true, balance: '1' })
    expect(r.balances[1]).toMatchObject({ ticker: 'USDC', isNative: false })
  })

  it('returns tokens_unavailable on a JSON-RPC error (typo address != empty wallet)', async () => {
    mockFetchJson.mockResolvedValueOnce({ error: { code: -32602, message: 'Invalid params' } })
    const r = await getSuiAllBalances('0xbad')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected not ok')
    expect(r.error).toBe('tokens_unavailable')
  })
})

describe('getCardanoBalance', () => {
  beforeEach(() => mockFetchJson.mockReset())

  it('formats lovelaces to ADA and maps native tokens', async () => {
    mockFetchJson
      .mockResolvedValueOnce([{ address: 'addr1', balance: '4200000' }])
      .mockResolvedValueOnce([
        { address: 'addr1', asset_list: [{ policy_id: 'aa', asset_name: '4d494c4b', quantity: '42' }] },
      ])
    const r = await getCardanoBalance('addr1xyz')
    expect(r.balanceAda).toBe('4.200000')
    expect(r.nativeTokens).toHaveLength(1)
    expect(r.nativeTokens[0].unit).toBe('aa4d494c4b')
  })
})

describe('getTaoBalance (gate before RPC)', () => {
  it('rejects a Polkadot address before any RPC call', async () => {
    await expect(getTaoBalance(DOT_ADDR)).rejects.toThrow(/prefix/i)
  })
})
