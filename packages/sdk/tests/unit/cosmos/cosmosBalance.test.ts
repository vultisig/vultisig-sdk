import { Chain } from '@vultisig/core-chain/Chain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the token-metadata resolver so the IBC denom-trace path is deterministic
// (no live RPC in unit tests). The decimals are still pinned from the SDK's
// IBC_SAFE_DECIMALS table, so the resolver only supplies the symbol.
vi.mock('@vultisig/core-chain/coin/token/metadata', () => ({
  getTokenMetadata: vi.fn(),
}))

import { getTokenMetadata } from '@vultisig/core-chain/coin/token/metadata'

import { cosmosBalanceChains, getCosmosBalance, isCosmosBalanceChain } from '../../../src/tools/balance/cosmos'

const mockedGetTokenMetadata = vi.mocked(getTokenMetadata)

function mockBank(balances: { denom: string; amount: string }[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ balances }),
    })) as unknown as typeof fetch
  )
}

describe('getCosmosBalance', () => {
  beforeEach(() => {
    mockedGetTokenMetadata.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('decodes + decimal-scales the native OSMO denom', async () => {
    mockBank([{ denom: 'uosmo', amount: '12500000' }])
    const res = await getCosmosBalance(Chain.Osmosis, 'osmo1abc')
    expect(res.nativeTicker).toBe('OSMO')
    expect(res.nativeRaw).toBe('12500000')
    expect(res.nativeFormatted).toBe('12.5')
    expect(res.chain).toBe(Chain.Osmosis)
    expect(res.balances[0]).toMatchObject({
      denom: 'uosmo',
      symbol: 'OSMO',
      formatted: '12.5',
      decimals: 6,
    })
  })

  it('scales 18-decimal native denom (dYdX) without precision loss', async () => {
    mockBank([{ denom: 'adydx', amount: '2500000000000000000' }])
    const res = await getCosmosBalance(Chain.Dydx, 'dydx1abc')
    expect(res.nativeFormatted).toBe('2.5')
    expect(res.nativeTicker).toBe('DYDX')
  })

  it('resolves a curated IBC-hash denom to symbol + decimals', async () => {
    // Osmosis ATOM IBC voucher is in the curated KNOWN_DENOMS table.
    mockBank([
      { denom: 'uosmo', amount: '1000000' },
      {
        denom: 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
        amount: '3000000',
      },
    ])
    const res = await getCosmosBalance(Chain.Osmosis, 'osmo1abc')
    const atom = res.balances.find(b => b.symbol === 'ATOM')
    expect(atom).toMatchObject({ symbol: 'ATOM', formatted: '3', decimals: 6 })
    // Curated table short-circuits the resolver — no live lookup.
    expect(mockedGetTokenMetadata).not.toHaveBeenCalled()
  })

  it('resolves an unknown IBC denom via getTokenMetadata, pinning decimals', async () => {
    mockedGetTokenMetadata.mockResolvedValue({ ticker: 'usdc', decimals: 999 } as never)
    mockBank([
      { denom: 'uosmo', amount: '1000000' },
      { denom: 'ibc/UNKNOWNHASH1234567890', amount: '5000000' },
    ])
    const res = await getCosmosBalance(Chain.Osmosis, 'osmo1abc')
    const usdc = res.balances.find(b => b.denom === 'ibc/UNKNOWNHASH1234567890')
    // decimals pinned from IBC_SAFE_DECIMALS (6), NOT the resolver's bogus 999.
    expect(usdc).toMatchObject({ symbol: 'USDC', formatted: '5', decimals: 6 })
    expect(mockedGetTokenMetadata).toHaveBeenCalledOnce()
  })

  it('emits unresolved IBC denoms in raw base units with a caveat', async () => {
    mockedGetTokenMetadata.mockResolvedValue(null as never)
    mockBank([
      { denom: 'uosmo', amount: '1000000' },
      { denom: 'ibc/DEADBEEFCAFEBABE0001', amount: '777' },
    ])
    const res = await getCosmosBalance(Chain.Osmosis, 'osmo1abc')
    const unresolved = res.balances.find(b => b.denom === 'ibc/DEADBEEFCAFEBABE0001')
    expect(unresolved).toMatchObject({
      amount: '777',
      formatted: '777',
      decimals: null,
      unresolved: true,
    })
    expect(unresolved?.symbol).toContain('(base units)')
  })

  it('filters out zero-amount denoms', async () => {
    mockBank([
      { denom: 'uosmo', amount: '0' },
      { denom: 'ibc/SOMEHASH', amount: '' },
    ])
    mockedGetTokenMetadata.mockResolvedValue(null as never)
    const res = await getCosmosBalance(Chain.Osmosis, 'osmo1abc')
    expect(res.balances).toHaveLength(0)
    expect(res.nativeFormatted).toBe('0')
  })

  it('never throws on a metadata-resolver failure (read must not fail)', async () => {
    mockedGetTokenMetadata.mockRejectedValue(new Error('rpc down'))
    mockBank([
      { denom: 'uosmo', amount: '1000000' },
      { denom: 'ibc/HASHWITHFAILEDLOOKUP', amount: '42' },
    ])
    const res = await getCosmosBalance(Chain.Osmosis, 'osmo1abc')
    const entry = res.balances.find(b => b.denom === 'ibc/HASHWITHFAILEDLOOKUP')
    expect(entry?.unresolved).toBe(true)
  })

  it('rejects an empty address', async () => {
    await expect(getCosmosBalance(Chain.Osmosis, '')).rejects.toThrow('address is required')
  })

  it('rejects a Rujira-enriched chain (not a vanilla bank-denom read)', async () => {
    await expect(getCosmosBalance(Chain.THORChain, 'thor1abc')).rejects.toThrow(/unsupported chain/)
  })

  it('falls back to the Polkachu mirror on a primary 5xx failure', async () => {
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        call += 1
        if (url.includes('osmosis-rest.publicnode.com')) {
          return { ok: false, status: 503, text: async () => 'down' }
        }
        // polkachu mirror
        return { ok: true, status: 200, json: async () => ({ balances: [{ denom: 'uosmo', amount: '9000000' }] }) }
      }) as unknown as typeof fetch
    )
    const res = await getCosmosBalance(Chain.Osmosis, 'osmo1abc')
    expect(res.nativeFormatted).toBe('9')
    expect(call).toBeGreaterThanOrEqual(2)
  })

  it('exposes the supported-chain guard + chain list', () => {
    expect(isCosmosBalanceChain(Chain.Osmosis)).toBe(true)
    expect(isCosmosBalanceChain(Chain.THORChain)).toBe(false)
    expect(isCosmosBalanceChain(Chain.Ethereum)).toBe(false)
    expect(cosmosBalanceChains).toContain(Chain.Osmosis)
    expect(cosmosBalanceChains).not.toContain(Chain.THORChain)
  })
})
