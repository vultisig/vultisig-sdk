import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChainDiscoveryService } from '@/seedphrase/ChainDiscoveryService'

const { mockDeriveAddress, mockDerivePhantom, mockDeriveTerraCosmosPath, mockGetCoinBalance } = vi.hoisted(() => ({
  mockDeriveAddress: vi.fn(),
  mockDerivePhantom: vi.fn(),
  mockDeriveTerraCosmosPath: vi.fn(),
  mockGetCoinBalance: vi.fn(),
}))

// vitest 4: vi.fn().mockImplementation(() => obj) is no longer constructable
// via `new`. Use vi.fn(function() { Object.assign(this, obj) }) instead so
// `new MasterKeyDeriver()` produces an instance with the mocked methods.
vi.mock('@/seedphrase/MasterKeyDeriver', () => ({
  MasterKeyDeriver: vi.fn(function (this: object) {
    Object.assign(this, {
      deriveAddress: mockDeriveAddress,
      deriveSolanaAddressWithPhantomPath: mockDerivePhantom,
      deriveTerraAddressWithCosmosPath: mockDeriveTerraCosmosPath,
    })
  }),
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
    mockDeriveTerraCosmosPath.mockResolvedValue('terra1-cosmos-path-addr')
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

  it('discoverChains returns useCosmosPathTerra=false when 330-path Terra has balance', async () => {
    mockDeriveAddress.mockImplementation(async (_m: string, chain: Chain) =>
      chain === Chain.Terra ? 'terra1-standard-330-addr' : `addr-${chain}`
    )
    mockGetCoinBalance.mockImplementation(async ({ address }: { address: string }) => {
      if (address === 'terra1-standard-330-addr') return 10_000_000n
      return 0n
    })

    const s = new ChainDiscoveryService(wasmProvider)
    const { useCosmosPathTerra } = await s.discoverChains('test mnemonic twelve words here about', {
      config: { chains: [Chain.Terra] },
    })

    expect(useCosmosPathTerra).toBe(false)
  })

  it('discoverChains sets useCosmosPathTerra=true when 330-path is empty but 118-path has balance', async () => {
    mockDeriveAddress.mockImplementation(async (_m: string, chain: Chain) =>
      chain === Chain.Terra ? 'terra1-standard-330-addr' : `addr-${chain}`
    )
    mockGetCoinBalance.mockImplementation(async ({ address }: { address: string }) => {
      if (address === 'terra1-standard-330-addr') return 0n
      if (address === 'terra1-cosmos-path-addr') return 7_000_000n
      return 0n
    })

    const s = new ChainDiscoveryService(wasmProvider)
    const { results, useCosmosPathTerra } = await s.discoverChains('test mnemonic twelve words here about', {
      config: { chains: [Chain.Terra] },
    })

    expect(useCosmosPathTerra).toBe(true)
    const terra = results.find(r => r.chain === Chain.Terra)
    expect(terra?.address).toBe('terra1-cosmos-path-addr')
    expect(terra?.hasBalance).toBe(true)
    expect(terra?.balance).toBe('7000000')
    expect(mockDeriveTerraCosmosPath).toHaveBeenCalled()
  })

  it('discoverChains returns useCosmosPathTerra=false when both 330-path and 118-path have zero balance', async () => {
    mockDeriveAddress.mockImplementation(async (_m: string, chain: Chain) =>
      chain === Chain.Terra ? 'terra1-standard-330-addr' : `addr-${chain}`
    )
    mockGetCoinBalance.mockResolvedValue(0n)

    const s = new ChainDiscoveryService(wasmProvider)
    const { useCosmosPathTerra } = await s.discoverChains('test mnemonic twelve words here about', {
      config: { chains: [Chain.Terra] },
    })

    expect(useCosmosPathTerra).toBe(false)
  })

  it('discoverChains prefers 330-path when both 330 and 118 have balance', async () => {
    mockDeriveAddress.mockImplementation(async (_m: string, chain: Chain) =>
      chain === Chain.Terra ? 'terra1-standard-330-addr' : `addr-${chain}`
    )
    mockGetCoinBalance.mockImplementation(async ({ address }: { address: string }) => {
      // Both paths have balance
      if (address === 'terra1-standard-330-addr') return 5_000_000n
      if (address === 'terra1-cosmos-path-addr') return 3_000_000n
      return 0n
    })

    const s = new ChainDiscoveryService(wasmProvider)
    const { results, useCosmosPathTerra } = await s.discoverChains('test mnemonic twelve words here about', {
      config: { chains: [Chain.Terra] },
    })

    // 330-path preferred: flag stays false, address stays on 330
    expect(useCosmosPathTerra).toBe(false)
    const terra = results.find(r => r.chain === Chain.Terra)
    expect(terra?.address).toBe('terra1-standard-330-addr')
  })
})
