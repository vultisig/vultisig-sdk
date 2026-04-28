import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChainDiscoveryService } from '@/seedphrase/ChainDiscoveryService'

const { mockDeriveAddress, mockDerivePhantom, mockGetCoinBalance } = vi.hoisted(() => ({
  mockDeriveAddress: vi.fn(),
  mockDerivePhantom: vi.fn(),
  mockGetCoinBalance: vi.fn(),
}))

vi.mock('@/seedphrase/MasterKeyDeriver', () => ({
  MasterKeyDeriver: vi.fn().mockImplementation(() => ({
    deriveAddress: mockDeriveAddress,
    deriveSolanaAddressWithPhantomPath: mockDerivePhantom,
  })),
}))

vi.mock('@vultisig/core-chain/coin/balance', () => ({
  getCoinBalance: mockGetCoinBalance,
}))

describe('ChainDiscoveryService', () => {
  const wasmProvider = { getWalletCore: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    mockDeriveAddress.mockImplementation(async (_mnemonic: string, chain: Chain) => `addr-${chain}`)
    mockDerivePhantom.mockResolvedValue('phantom-addr')
    mockGetCoinBalance.mockResolvedValue(0n)
  })

  it('isEddsaChain is true for EdDSA chains', () => {
    const s = new ChainDiscoveryService(wasmProvider)
    expect(s.isEddsaChain(Chain.Solana)).toBe(true)
    expect(s.isEddsaChain(Chain.Ethereum)).toBe(false)
  })

  it('sortByBalance puts funded chains first then sorts by amount descending', () => {
    const s = new ChainDiscoveryService(wasmProvider)
    const sorted = s.sortByBalance([
      {
        chain: Chain.Bitcoin,
        address: '',
        balance: '1',
        decimals: 8,
        symbol: 'BTC',
        hasBalance: true,
      },
      {
        chain: Chain.Ethereum,
        address: '',
        balance: '2',
        decimals: 18,
        symbol: 'ETH',
        hasBalance: true,
      },
      {
        chain: Chain.Dash,
        address: '',
        balance: '0',
        decimals: 8,
        symbol: 'DASH',
        hasBalance: false,
      },
    ])
    expect(sorted.map(r => r.chain)).toEqual([Chain.Ethereum, Chain.Bitcoin, Chain.Dash])
  })

  it('discoverChains runs batches and reports progress', async () => {
    const s = new ChainDiscoveryService(wasmProvider)
    const progress = vi.fn()

    const { results, usePhantomSolanaPath } = await s.discoverChains('test mnemonic twelve words here about', {
      config: { chains: [Chain.Ethereum, Chain.Bitcoin], concurrencyLimit: 1 },
      onProgress: progress,
    })

    expect(usePhantomSolanaPath).toBe(false)
    expect(results).toHaveLength(2)
    expect(results.every(r => !r.hasBalance)).toBe(true)
    expect(mockDeriveAddress).toHaveBeenCalled()
    expect(mockGetCoinBalance).toHaveBeenCalled()
    expect(progress.mock.calls.length).toBeGreaterThan(0)
    expect(progress.mock.calls[0][0].phase).toBe('validating')
  })

  it('discoverChains adds zero-balance placeholder when balance fetch times out', async () => {
    mockGetCoinBalance.mockImplementation(() => new Promise<bigint>(() => {}))
    const s = new ChainDiscoveryService(wasmProvider)

    const { results } = await s.discoverChains('test mnemonic twelve words here about', {
      config: { chains: [Chain.Ethereum], concurrencyLimit: 1, timeoutPerChain: 5 },
    })

    expect(results).toHaveLength(1)
    expect(results[0].hasBalance).toBe(false)
    expect(results[0].balance).toBe('0')
  })

  it('discoverChains sets usePhantomSolanaPath when standard Solana is empty but Phantom path has funds', async () => {
    mockDeriveAddress.mockImplementation(async (_m: string, chain: Chain) =>
      chain === Chain.Solana ? 'sol-standard' : `addr-${chain}`
    )
    mockGetCoinBalance.mockImplementation(async ({ address }: { address: string }) => {
      if (address === 'sol-standard') return 0n
      if (address === 'phantom-addr') return 5_000_000n
      return 0n
    })

    const s = new ChainDiscoveryService(wasmProvider)
    const { results, usePhantomSolanaPath } = await s.discoverChains('test mnemonic twelve words here about', {
      config: { chains: [Chain.Solana] },
    })

    expect(usePhantomSolanaPath).toBe(true)
    const sol = results.find(r => r.chain === Chain.Solana)
    expect(sol?.address).toBe('phantom-addr')
    expect(sol?.hasBalance).toBe(true)
    expect(sol?.balance).toBe('5000000')
    expect(mockDerivePhantom).toHaveBeenCalled()
  })

  it('enforces concurrencyLimit of at least 1', async () => {
    const s = new ChainDiscoveryService(wasmProvider)
    await s.discoverChains('test mnemonic twelve words here about', {
      config: { chains: [Chain.Ethereum], concurrencyLimit: 0 },
    })
    expect(mockDeriveAddress).toHaveBeenCalled()
  })
})
