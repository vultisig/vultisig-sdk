import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQueryUrl = vi.fn()

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (...args: unknown[]) => mockQueryUrl(...args),
}))

vi.mock('@vultisig/core-config', () => ({
  rootApiUrl: 'https://api.vultisig.com',
}))

import {
  balancePolkadot,
  DOT_DECIMALS,
  formatDot,
  getPolkadotAssetBalance,
  getPolkadotNativeBalance,
} from '@/tools/balance/polkadot'

// A real Polkadot relay-chain address (SS58 prefix 0). Web3 Foundation treasury-style
// public address; decodes cleanly with a valid checksum.
const POLKADOT_ADDR = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'
// A Bittensor address (SS58 prefix 42, starts with `5`) — same 32-byte AccountId space,
// MUST be rejected to avoid fund-confusion.
const BITTENSOR_ADDR = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'

// Build a little-endian u128 hex (16 bytes) from a bigint.
const u128LE = (v: bigint): string => {
  const bytes: string[] = []
  let x = v
  for (let i = 0; i < 16; i++) {
    bytes.push((x & 0xffn).toString(16).padStart(2, '0'))
    x >>= 8n
  }
  return bytes.join('')
}

// Build a little-endian u32 hex (4 bytes) from a number.
const u32LE = (n: number): string => {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n, true)
  return Array.from(b)
    .map(x => x.toString(16).padStart(2, '0'))
    .join('')
}

// SCALE AccountInfo: nonce(u32) consumers(u32) providers(u32) sufficients(u32)
//   + AccountData { free(u128) reserved(u128) frozen(u128) flags(u128) }
const buildAccountInfoHex = (opts: { nonce: number; free: bigint; reserved: bigint; frozen: bigint }): string => {
  return (
    '0x' +
    u32LE(opts.nonce) + // nonce
    u32LE(1) + // consumers
    u32LE(1) + // providers
    u32LE(0) + // sufficients
    u128LE(opts.free) +
    u128LE(opts.reserved) +
    u128LE(opts.frozen) +
    u128LE(0n) // flags
  )
}

describe('formatDot', () => {
  it('formats whole DOT with no fractional part', () => {
    expect(formatDot(10n ** BigInt(DOT_DECIMALS))).toBe('1') // 1e10 planck = 1 DOT
  })

  it('trims trailing zeros in the fractional part', () => {
    // 1.5 DOT = 15_000_000_000 planck
    expect(formatDot(15_000_000_000n)).toBe('1.5')
  })

  it('handles sub-DOT amounts with zero-padding', () => {
    // 0.0000000001 DOT = 1 planck → smallest unit
    expect(formatDot(1n)).toBe('0.0000000001')
  })

  it('handles zero', () => {
    expect(formatDot(0n)).toBe('0')
  })
})

describe('getPolkadotNativeBalance — SCALE AccountInfo parse', () => {
  beforeEach(() => vi.clearAllMocks())

  it('parses free/reserved/frozen and derives total + spendable', async () => {
    const free = 25_000_000_000n // 2.5 DOT
    const reserved = 5_000_000_000n // 0.5 DOT
    const frozen = 10_000_000_000n // 1.0 DOT
    mockQueryUrl.mockResolvedValueOnce({
      result: buildAccountInfoHex({ nonce: 7, free, reserved, frozen }),
    })

    const res = await getPolkadotNativeBalance(POLKADOT_ADDR)

    expect(res.address).toBe(POLKADOT_ADDR)
    expect(res.nonce).toBe(7)
    expect(res.freePlanck).toBe('25000000000')
    expect(res.freeDot).toBe('2.5')
    expect(res.reservedPlanck).toBe('5000000000')
    expect(res.reservedDot).toBe('0.5')
    expect(res.frozenPlanck).toBe('10000000000')
    expect(res.frozenDot).toBe('1')
    // total = free + reserved = 3.0 DOT
    expect(res.totalPlanck).toBe('30000000000')
    expect(res.totalDot).toBe('3')
    // spendable = free - frozen = 1.5 DOT
    expect(res.spendablePlanck).toBe('15000000000')
    expect(res.spendableDot).toBe('1.5')
  })

  it('clamps spendable to 0 when frozen exceeds free', async () => {
    mockQueryUrl.mockResolvedValueOnce({
      result: buildAccountInfoHex({ nonce: 0, free: 1_000_000_000n, reserved: 0n, frozen: 9_000_000_000n }),
    })
    const res = await getPolkadotNativeBalance(POLKADOT_ADDR)
    expect(res.spendablePlanck).toBe('0')
    expect(res.spendableDot).toBe('0')
  })

  it('returns all-zero for a non-existent (null result) account', async () => {
    mockQueryUrl.mockResolvedValueOnce({ result: null })
    const res = await getPolkadotNativeBalance(POLKADOT_ADDR)
    expect(res.freePlanck).toBe('0')
    expect(res.totalPlanck).toBe('0')
    expect(res.spendablePlanck).toBe('0')
    expect(res.nonce).toBe(0)
  })

  it('does NOT lose precision above 2^53 (u128 via BigInt)', async () => {
    const huge = 123_456_789_012_345_678_901n // > 2^53
    mockQueryUrl.mockResolvedValueOnce({
      result: buildAccountInfoHex({ nonce: 0, free: huge, reserved: 0n, frozen: 0n }),
    })
    const res = await getPolkadotNativeBalance(POLKADOT_ADDR)
    expect(res.freePlanck).toBe(huge.toString())
  })

  it('surfaces an RPC error', async () => {
    mockQueryUrl.mockResolvedValueOnce({ error: { code: -32000, message: 'boom' } })
    await expect(getPolkadotNativeBalance(POLKADOT_ADDR)).rejects.toThrow(/boom/)
  })
})

describe('address gate (fund-confusion guard)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects a Bittensor (prefix=42) address before any RPC call', async () => {
    await expect(getPolkadotNativeBalance(BITTENSOR_ADDR)).rejects.toThrow(/Not a Polkadot address|prefix/)
    expect(mockQueryUrl).not.toHaveBeenCalled()
  })

  it('rejects an EVM hex address', async () => {
    await expect(getPolkadotNativeBalance('0x1234567890abcdef')).rejects.toThrow(/EVM\/hex/)
    expect(mockQueryUrl).not.toHaveBeenCalled()
  })

  it('rejects a typo (bad checksum) address', async () => {
    // Flip the last char of a valid address → checksum failure.
    const typo = POLKADOT_ADDR.slice(0, -1) + (POLKADOT_ADDR.endsWith('5') ? '6' : '5')
    await expect(getPolkadotNativeBalance(typo)).rejects.toThrow()
    expect(mockQueryUrl).not.toHaveBeenCalled()
  })
})

describe('getPolkadotAssetBalance — pallet_assets', () => {
  beforeEach(() => vi.clearAllMocks())

  it('parses a u128 asset balance (USDT id=1984)', async () => {
    // 12.5 USDT (6 decimals) = 12_500_000 base units.
    mockQueryUrl.mockResolvedValueOnce({ result: '0x' + u128LE(12_500_000n) + '00' /* status byte */ })
    const res = await getPolkadotAssetBalance(POLKADOT_ADDR, '1984')
    expect(res.assetId).toBe('1984')
    expect(res.balanceRaw).toBe('12500000')
  })

  it('returns 0 for a null (no entry) asset account', async () => {
    mockQueryUrl.mockResolvedValueOnce({ result: null })
    const res = await getPolkadotAssetBalance(POLKADOT_ADDR, '1337')
    expect(res.balanceRaw).toBe('0')
  })

  it('rejects an out-of-range asset_id', async () => {
    await expect(getPolkadotAssetBalance(POLKADOT_ADDR, '99999999999')).rejects.toThrow(/asset_id/)
  })
})

describe('balancePolkadot dispatch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('routes to native when no assetId', async () => {
    mockQueryUrl.mockResolvedValueOnce({
      result: buildAccountInfoHex({ nonce: 1, free: 10_000_000_000n, reserved: 0n, frozen: 0n }),
    })
    const res = await balancePolkadot({ address: POLKADOT_ADDR })
    expect('freeDot' in res).toBe(true)
  })

  it('routes to asset when assetId provided', async () => {
    mockQueryUrl.mockResolvedValueOnce({ result: '0x' + u128LE(7n) })
    const res = await balancePolkadot({ address: POLKADOT_ADDR, assetId: '1984' })
    expect('balanceRaw' in res).toBe(true)
  })

  it('throws on missing address', () => {
    expect(() => balancePolkadot({ address: '' })).toThrow(/address is required/)
  })
})
