import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the EVM client before importing the module under test.
const mockGetGasPrice = vi.fn()
vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({ getGasPrice: mockGetGasPrice }),
}))

import { compareCosts, GAS_UNITS } from '@/tools/gas/compareCosts'

describe('compareCosts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ranks chains cheapest-first by native tx cost', async () => {
    // gwei values: Ethereum 30, Base 0.01, Arbitrum 0.1
    const byChain: Record<string, bigint> = {
      Ethereum: 30_000_000_000n, // 30 gwei
      Base: 10_000_000n, // 0.01 gwei
      Arbitrum: 100_000_000n, // 0.1 gwei
    }
    let call = 0
    const order = ['Ethereum', 'Base', 'Arbitrum']
    mockGetGasPrice.mockImplementation(() => Promise.resolve(byChain[order[call++]]))

    const res = await compareCosts({ chains: ['Ethereum', 'Base', 'Arbitrum'] })

    expect(res.txType).toBe('transfer')
    expect(res.gasUnits).toBe(GAS_UNITS.transfer)
    expect(res.skipped).toEqual([])
    expect(res.results.map(r => r.chain)).toEqual(['Base', 'Arbitrum', 'Ethereum'])
    expect(res.cheapest?.chain).toBe('Base')
    // Base: 0.01 gwei * 1e-9 * 21000 = 2.1e-7 ETH
    expect(res.results[0].estTxCostNative).toBeCloseTo(0.01 * 1e-9 * 21_000, 15)
    expect(res.results[0].nativeUsd).toBeNull()
    expect(res.results[0].estTxCostUsd).toBeNull()
  })

  it('computes USD cost when native prices are injected and ranks by USD', async () => {
    const byChain: Record<string, bigint> = {
      Ethereum: 20_000_000_000n, // 20 gwei
      Polygon: 30_000_000_000n, // 30 gwei
    }
    let call = 0
    const order = ['Ethereum', 'Polygon']
    mockGetGasPrice.mockImplementation(() => Promise.resolve(byChain[order[call++]]))

    const res = await compareCosts({
      chains: ['Ethereum', 'Polygon'],
      txType: 'swap',
      nativeUsdPrices: { Ethereum: 3000, Polygon: 0.5 },
    })

    expect(res.gasUnits).toBe(GAS_UNITS.swap)
    // Polygon: 30 gwei * 1e-9 * 150000 * $0.5 = $0.00225  (cheaper in USD)
    // Ethereum: 20 gwei * 1e-9 * 150000 * $3000 = $9.0
    expect(res.results.map(r => r.chain)).toEqual(['Polygon', 'Ethereum'])
    expect(res.cheapest?.chain).toBe('Polygon')
    expect(res.results.find(r => r.chain === 'Ethereum')?.estTxCostUsd).toBeCloseTo(9, 6)
  })

  it('does not mix USD/native bases when the price map is partial (no false cheapest)', async () => {
    // Ethereum priced ($3000/ETH), Polygon UNpriced. Both 30 gwei → identical
    // *native* number (6.3e-4) but Ethereum is ~$1.89 vs Polygon's ~$0.0000126.
    // A per-pair mixed comparator would tie them on native and could crown the
    // $1.89 Ethereum tx as cheapest. With a partial map we must rank wholesale on
    // native (the documented gwei-only fallback), NEVER let a USD value leak in.
    const byChain: Record<string, bigint> = {
      Ethereum: 30_000_000_000n, // 30 gwei
      Polygon: 10_000_000_000n, // 10 gwei → strictly cheaper native
    }
    let call = 0
    const order = ['Ethereum', 'Polygon']
    mockGetGasPrice.mockImplementation(() => Promise.resolve(byChain[order[call++]]))

    const res = await compareCosts({
      chains: ['Ethereum', 'Polygon'],
      nativeUsdPrices: { Ethereum: 3000 }, // partial — Polygon omitted
    })

    // Pure native ranking: Polygon (10 gwei) < Ethereum (30 gwei).
    expect(res.results.map(r => r.chain)).toEqual(['Polygon', 'Ethereum'])
    expect(res.cheapest?.chain).toBe('Polygon')
    // cheapest must NOT be decided on the lone injected USD value.
    expect(res.cheapest?.estTxCostUsd).toBeNull()
  })

  it('USD-ranks only when EVERY surviving chain is priced', async () => {
    // Ethereum cheaper native (10 gwei) but ETH is dear; Polygon dearer native
    // (30 gwei) but MATIC is cheap → USD flips the order. Both priced → USD wins.
    const byChain: Record<string, bigint> = {
      Ethereum: 10_000_000_000n, // 10 gwei
      Polygon: 30_000_000_000n, // 30 gwei
    }
    let call = 0
    const order = ['Ethereum', 'Polygon']
    mockGetGasPrice.mockImplementation(() => Promise.resolve(byChain[order[call++]]))

    const res = await compareCosts({
      chains: ['Ethereum', 'Polygon'],
      nativeUsdPrices: { Ethereum: 3000, Polygon: 0.5 },
    })

    // USD: Ethereum 10*1e-9*21000*3000 = $0.63 ; Polygon 30*1e-9*21000*0.5 = $0.000315
    expect(res.results.map(r => r.chain)).toEqual(['Polygon', 'Ethereum'])
    expect(res.cheapest?.chain).toBe('Polygon')
    expect(res.cheapest?.estTxCostUsd).toBeCloseTo(0.000315, 6)
  })

  it('is fail-soft: a failing RPC lands in skipped, not a rejection', async () => {
    const byChain: Record<string, bigint | Error> = {
      Ethereum: 25_000_000_000n,
      Base: new Error('rpc down'),
    }
    let call = 0
    const order = ['Ethereum', 'Base']
    mockGetGasPrice.mockImplementation(() => {
      const v = byChain[order[call++]]
      return v instanceof Error ? Promise.reject(v) : Promise.resolve(v)
    })

    const res = await compareCosts({ chains: ['Ethereum', 'Base'] })

    expect(res.results.map(r => r.chain)).toEqual(['Ethereum'])
    expect(res.skipped).toEqual([{ chain: 'Base', error: 'rpc down' }])
    expect(res.cheapest?.chain).toBe('Ethereum')
  })

  it('returns cheapest=null when every chain errors', async () => {
    mockGetGasPrice.mockRejectedValue(new Error('boom'))

    const res = await compareCosts({ chains: ['Ethereum', 'Base'] })

    expect(res.results).toEqual([])
    expect(res.cheapest).toBeNull()
    expect(res.skipped).toHaveLength(2)
  })
})
