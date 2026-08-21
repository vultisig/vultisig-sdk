import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQueryUrl = vi.fn()

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (...args: unknown[]) => mockQueryUrl(...args),
}))

vi.mock('@vultisig/core-config', () => ({
  rootApiUrl: 'https://api.vultisig.com',
}))

import { searchToken } from '@/tools/token/searchToken'

describe('searchToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('searches and returns tokens with deployments', async () => {
    // First call: search
    mockQueryUrl.mockResolvedValueOnce({
      coins: [{ id: 'usd-coin', name: 'USD Coin', symbol: 'usdc', market_cap_rank: 6 }],
    })

    // Second call: coin detail
    mockQueryUrl.mockResolvedValueOnce({
      id: 'usd-coin',
      detail_platforms: {
        ethereum: { contract_address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimal_place: 6 },
        'polygon-pos': { contract_address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', decimal_place: 6 },
        solana: { contract_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimal_place: 6 },
      },
    })

    const results = await searchToken('USDC')

    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('USD Coin')
    expect(results[0].symbol).toBe('usdc')
    expect(results[0].marketCapRank).toBe(6)
    expect(results[0].deployments).toHaveLength(3)

    const ethDeploy = results[0].deployments.find(d => d.chain === 'Ethereum')
    expect(ethDeploy).toBeDefined()
    expect(ethDeploy!.contractAddress).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
    expect(ethDeploy!.decimals).toBe(6)

    const solDeploy = results[0].deployments.find(d => d.chain === 'Solana')
    expect(solDeploy).toBeDefined()
  })

  it('returns empty array on API failure', async () => {
    mockQueryUrl.mockResolvedValue(null)

    const results = await searchToken('nonexistent')

    expect(results).toEqual([])
  })

  it('handles coins with no contract addresses', async () => {
    mockQueryUrl.mockResolvedValueOnce({
      coins: [{ id: 'bitcoin', name: 'Bitcoin', symbol: 'btc', market_cap_rank: 1 }],
    })

    // Bitcoin has no contract deployments
    mockQueryUrl.mockResolvedValueOnce({
      id: 'bitcoin',
      detail_platforms: {},
    })

    const results = await searchToken('BTC')

    expect(results).toHaveLength(1)
    expect(results[0].deployments).toHaveLength(0)
  })

  it('maps canonical CoinGecko platforms back to SDK chains', async () => {
    mockQueryUrl.mockResolvedValueOnce({
      coins: [{ id: 'test-token', name: 'Test', symbol: 'TEST', market_cap_rank: null }],
    })

    mockQueryUrl.mockResolvedValueOnce({
      id: 'test-token',
      detail_platforms: {
        'avalanche': { contract_address: '0xavax', decimal_place: 18 },
        'zksync': { contract_address: '0xzk', decimal_place: 18 },
        sei: { contract_address: '0xsei', decimal_place: 18 },
        'the-open-network': { contract_address: 'EQTON', decimal_place: 9 },
        'some-unknown-chain': { contract_address: '0xabc', decimal_place: 18 },
        ethereum: { contract_address: '0xdef', decimal_place: 18 },
      },
    })

    const results = await searchToken('TEST')

    expect(results[0].deployments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chain: 'Avalanche', contractAddress: '0xavax', decimals: 18 }),
        expect.objectContaining({ chain: 'Zksync', contractAddress: '0xzk', decimals: 18 }),
        expect.objectContaining({ chain: 'Sei', contractAddress: '0xsei', decimals: 18 }),
        expect.objectContaining({ chain: 'Ton', contractAddress: 'EQTON', decimals: 9 }),
        expect.objectContaining({ chain: 'Ethereum', contractAddress: '0xdef', decimals: 18 }),
      ])
    )
    expect(results[0].deployments).toHaveLength(5)
  })

  // Regression for sdk#1219: XRPL issued currencies (curated in
  // knownTokens[Chain.Ripple]) aren't modeled as CoinGecko platform
  // deployments, so they were invisible on the public search surface even
  // though the SDK already knows about them internally.
  it('overlays the curated RLUSD deployment onto its matching CoinGecko coin', async () => {
    mockQueryUrl.mockResolvedValueOnce({
      coins: [{ id: 'ripple-usd', name: 'Ripple USD', symbol: 'rlusd', market_cap_rank: 42 }],
    })
    // CoinGecko's own detail response has no `ripple` platform entry for RLUSD.
    mockQueryUrl.mockResolvedValueOnce({
      id: 'ripple-usd',
      detail_platforms: {
        ethereum: { contract_address: '0x8292bb45bf1ee4d140127049757c2e0ff06317ed', decimal_place: 18 },
      },
    })

    const results = await searchToken('RLUSD')

    expect(results).toHaveLength(1)
    const rippleDeploy = results[0].deployments.find(d => d.chain === 'Ripple')
    expect(rippleDeploy).toBeDefined()
    expect(rippleDeploy!.contractAddress).toBe(
      '524C555344000000000000000000000000000000.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'
    )
    expect(rippleDeploy!.decimals).toBe(15)
    // The Ethereum deployment from CoinGecko's own detail response is untouched.
    expect(results[0].deployments).toHaveLength(2)
  })

  it('does not overlay a Ripple deployment for a CoinGecko coin unrelated to any curated XRPL token', async () => {
    mockQueryUrl.mockResolvedValueOnce({
      coins: [{ id: 'usd-coin', name: 'USD Coin', symbol: 'usdc', market_cap_rank: 6 }],
    })
    mockQueryUrl.mockResolvedValueOnce({ id: 'usd-coin', detail_platforms: {} })

    const results = await searchToken('USDC')

    expect(results[0].deployments.some(d => d.chain === 'Ripple')).toBe(false)
  })

  it('respects limit parameter', async () => {
    mockQueryUrl.mockResolvedValueOnce({
      coins: [
        { id: 'a', name: 'A', symbol: 'a', market_cap_rank: 1 },
        { id: 'b', name: 'B', symbol: 'b', market_cap_rank: 2 },
        { id: 'c', name: 'C', symbol: 'c', market_cap_rank: 3 },
      ],
    })

    // Mock detail calls for the 2 that should be fetched
    mockQueryUrl.mockResolvedValueOnce({ id: 'a', detail_platforms: {} })
    mockQueryUrl.mockResolvedValueOnce({ id: 'b', detail_platforms: {} })

    const results = await searchToken('test', 2)

    expect(results).toHaveLength(2)
  })
})
