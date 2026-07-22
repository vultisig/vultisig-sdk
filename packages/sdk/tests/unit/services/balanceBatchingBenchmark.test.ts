import { Chain } from '@vultisig/core-chain/Chain'
import { accountCoinKeyToString } from '@vultisig/core-chain/coin/AccountCoin'
import { getCoinBalance } from '@vultisig/core-chain/coin/balance'
import { getEvmChainBalances } from '@vultisig/core-chain/coin/balance/getEvmChainBalances'
import { getErc20Prices } from '@vultisig/core-chain/coin/price/evm/getErc20Prices'
import { getCoinPrices } from '@vultisig/core-chain/coin/price/getCoinPrices'
import { getCoinValue } from '@vultisig/core-chain/coin/utils/getCoinValue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CacheService } from '../../../src/services/CacheService'
import { FiatValueService } from '../../../src/services/FiatValueService'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'
import type { Token } from '../../../src/types'
import { BalanceService } from '../../../src/vault/services/BalanceService'

vi.mock('@vultisig/core-chain/coin/balance', () => ({ getCoinBalance: vi.fn() }))
vi.mock('@vultisig/core-chain/coin/balance/getEvmChainBalances', () => ({ getEvmChainBalances: vi.fn() }))
vi.mock('@vultisig/core-chain/coin/price/getCoinPrices')
vi.mock('@vultisig/core-chain/coin/price/evm/getErc20Prices')
vi.mock('@vultisig/core-chain/coin/utils/getCoinValue')

const makeToken = (chain: Chain, i: number): Token => ({
  id: `0x${(i + 1).toString(16).padStart(40, '0')}`,
  symbol: `TK${i}`,
  name: `Token ${i}`,
  decimals: 18,
  chainId: chain,
  contractAddress: `0x${(i + 1).toString(16).padStart(40, '0')}`,
})

describe('balance/fiat batching benchmark (call-count A/B)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Every requested coin resolves to 1n; keyed exactly as core does.
    vi.mocked(getEvmChainBalances).mockImplementation(async ({ chain, address, coins }) =>
      Object.fromEntries(coins.map(coin => [accountCoinKeyToString({ ...coin, chain, address }), 1n]))
    )
    vi.mocked(getCoinBalance).mockResolvedValue(1n)
  })

  it('collapses per-token balance RPCs into one Multicall3 per EVM chain', async () => {
    const evmChains = [Chain.Ethereum, Chain.Base, Chain.Arbitrum]
    const nonEvmChains = [Chain.Bitcoin, Chain.Solana]
    const tokensPerChain = 5

    const tokensByChain: Record<string, Token[]> = {}
    for (const chain of evmChains) {
      tokensByChain[chain] = Array.from({ length: tokensPerChain }, (_, i) => makeToken(chain, i))
    }

    const service = new BalanceService(
      new CacheService(new MemoryStorage(), 'bench-balance'),
      vi.fn(),
      vi.fn(),
      async chain => `${chain}-address`,
      chain => tokensByChain[chain] ?? [],
      () => tokensByChain,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn()
    )

    await service.getBalances({ chains: [...evmChains, ...nonEvmChains], includeTokens: true })

    // BEFORE (per-token fan-out): one getCoinBalance RPC per coin =
    //   sum over chains of (1 native + tokens) = 3*(1+5) + 2*(1+0) = 20.
    const beforeBalanceRpcs = evmChains.length * (1 + tokensPerChain) + nonEvmChains.length
    // AFTER: one Multicall3 per EVM chain + one getCoinBalance per non-EVM native.
    const afterBalanceRpcs =
      vi.mocked(getEvmChainBalances).mock.calls.length + vi.mocked(getCoinBalance).mock.calls.length

    expect(getEvmChainBalances).toHaveBeenCalledTimes(evmChains.length) // 3
    expect(getCoinBalance).toHaveBeenCalledTimes(nonEvmChains.length) // 2
    expect(beforeBalanceRpcs).toBe(20)
    expect(afterBalanceRpcs).toBe(5)
    expect(afterBalanceRpcs).toBeLessThan(beforeBalanceRpcs)
  })

  it('collapses per-token price lookups into one batched getErc20Prices per chain', async () => {
    const tokensPerChain = 5
    const tokens = Array.from({ length: tokensPerChain }, (_, i) => makeToken(Chain.Ethereum, i))

    vi.mocked(getCoinPrices).mockResolvedValue({ ethereum: 3000 })
    vi.mocked(getErc20Prices).mockImplementation(async ({ ids }) =>
      Object.fromEntries(ids.map(id => [id.toLowerCase(), 1]))
    )
    vi.mocked(getCoinValue).mockReturnValue(1)

    const service = new FiatValueService(
      new CacheService(new MemoryStorage()),
      () => 'usd',
      () => ({ [Chain.Ethereum]: tokens }),
      () => [Chain.Ethereum],
      vi.fn(async (_chain: Chain, tokenId?: string) => ({
        amount: '1',
        formattedAmount: '1',
        decimals: 18,
        symbol: tokenId ? 'TK' : 'ETH',
        chainId: Chain.Ethereum,
        tokenId,
      }))
    )

    await service.getValues(Chain.Ethereum)

    // BEFORE: one single-id getErc20Prices per token = 5. AFTER: one batched call.
    const beforePriceCalls = tokensPerChain
    expect(getErc20Prices).toHaveBeenCalledTimes(1)
    expect(1).toBeLessThan(beforePriceCalls)
  })

  it('fetches every chain concurrently in getTotalValue (was a sequential loop)', async () => {
    const chains = [Chain.Ethereum, Chain.Base, Chain.Arbitrum, Chain.Optimism]

    let inFlight = 0
    let maxConcurrent = 0
    const getBalance = vi.fn(async (chain: Chain) => {
      inFlight += 1
      maxConcurrent = Math.max(maxConcurrent, inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight -= 1
      return { amount: '1', formattedAmount: '1', decimals: 18, symbol: 'ETH', chainId: chain }
    })

    vi.mocked(getCoinPrices).mockResolvedValue({
      ethereum: 1,
      base: 1,
      'arbitrum-one': 1,
      'optimistic-ethereum': 1,
    })
    vi.mocked(getCoinValue).mockReturnValue(1)

    const service = new FiatValueService(
      new CacheService(new MemoryStorage()),
      () => 'usd',
      () => ({}),
      () => chains,
      getBalance
    )

    await service.getTotalValue()

    // Sequential (old) would cap in-flight balance fetches at 1; parallel chains overlap.
    expect(maxConcurrent).toBeGreaterThan(1)
  })

  it("bounds the fan-out of updateValues('all') the same way getTotalValue does", async () => {
    // More chains than TOTAL_VALUE_CONCURRENCY (8), so an unbounded Promise.all is observable.
    const chains = [
      Chain.Ethereum,
      Chain.Base,
      Chain.Arbitrum,
      Chain.Optimism,
      Chain.Polygon,
      Chain.Avalanche,
      Chain.BSC,
      Chain.Blast,
      Chain.CronosChain,
      Chain.Zksync,
      Chain.Bitcoin,
      Chain.Litecoin,
    ]

    let inFlight = 0
    let maxConcurrent = 0
    const getBalance = vi.fn(async (chain: Chain) => {
      inFlight += 1
      maxConcurrent = Math.max(maxConcurrent, inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight -= 1
      return { amount: '1', formattedAmount: '1', decimals: 18, symbol: 'ETH', chainId: chain }
    })

    vi.mocked(getCoinPrices).mockResolvedValue({})
    vi.mocked(getCoinValue).mockReturnValue(1)

    const service = new FiatValueService(
      new CacheService(new MemoryStorage()),
      () => 'usd',
      () => ({}),
      () => chains,
      getBalance
    )

    await service.updateValues('all')

    // Every chain is visited, but never more than the cap at once. A raw Promise.all would reach 12.
    expect(getBalance).toHaveBeenCalledTimes(chains.length)
    expect(maxConcurrent).toBeGreaterThan(1)
    expect(maxConcurrent).toBeLessThanOrEqual(8)
  })
})

describe('balance batching — graceful degradation preserved', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports 0n for a coin the multicall omitted without dropping its siblings', async () => {
    const tokenA = makeToken(Chain.Ethereum, 1)
    const tokenB = makeToken(Chain.Ethereum, 2)

    const address = `${Chain.Ethereum}-address`
    // Multicall resolves native + tokenA, but OMITS tokenB (e.g. its call failed).
    vi.mocked(getEvmChainBalances).mockResolvedValue({
      [accountCoinKeyToString({ chain: Chain.Ethereum, address })]: 7n,
      [accountCoinKeyToString({ chain: Chain.Ethereum, id: tokenA.id, address })]: 3n,
    })

    const service = new BalanceService(
      new CacheService(new MemoryStorage(), 'bench-degrade'),
      vi.fn(),
      vi.fn(),
      async chain => `${chain}-address`,
      () => [tokenA, tokenB],
      () => ({ [Chain.Ethereum]: [tokenA, tokenB] }),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn()
    )

    const result = await service.getBalances({ chains: [Chain.Ethereum], includeTokens: true })

    // Whole chain survives: native + tokenA real, tokenB degrades to 0 (not dropped).
    expect(result[Chain.Ethereum]?.amount).toBe('7')
    expect(result[`${Chain.Ethereum}:${tokenA.id}`]?.amount).toBe('3')
    expect(result[`${Chain.Ethereum}:${tokenB.id}`]?.amount).toBe('0')
  })

  it('a failing non-EVM chain does not drop the EVM chains', async () => {
    const address = `${Chain.Ethereum}-address`
    vi.mocked(getEvmChainBalances).mockResolvedValue({
      [accountCoinKeyToString({ chain: Chain.Ethereum, address })]: 5n,
    })
    vi.mocked(getCoinBalance).mockRejectedValue(new Error('RPC down'))

    const service = new BalanceService(
      new CacheService(new MemoryStorage(), 'bench-degrade-2'),
      vi.fn(),
      vi.fn(),
      async chain => `${chain}-address`,
      () => [],
      () => ({}),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn()
    )

    const result = await service.getBalances({ chains: [Chain.Ethereum, Chain.Bitcoin], includeTokens: true })

    expect(result[Chain.Ethereum]?.amount).toBe('5')
    expect(result[Chain.Bitcoin]).toBeUndefined()
  })
})
