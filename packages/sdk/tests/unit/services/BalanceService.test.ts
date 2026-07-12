import { Chain } from '@vultisig/core-chain/Chain'
import { accountCoinKeyToString } from '@vultisig/core-chain/coin/AccountCoin'
import { getCoinBalance } from '@vultisig/core-chain/coin/balance'
import { getEvmChainBalances } from '@vultisig/core-chain/coin/balance/getEvmChainBalances'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CacheService } from '../../../src/services/CacheService'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'
import type { Token } from '../../../src/types'
import { BalanceService } from '../../../src/vault/services/BalanceService'

vi.mock('@vultisig/core-chain/coin/balance', () => ({
  getCoinBalance: vi.fn(),
}))

vi.mock('@vultisig/core-chain/coin/balance/getEvmChainBalances', () => ({
  getEvmChainBalances: vi.fn(),
}))

const token: Token = {
  id: '0x00000000000000000000000000000000000000aa',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
  chainId: Chain.Ethereum,
}

const flushMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('BalanceService', () => {
  let cacheService: CacheService

  beforeEach(() => {
    cacheService = new CacheService(new MemoryStorage(), 'balance-service-test')
    vi.clearAllMocks()
  })

  const makeService = () =>
    new BalanceService(
      cacheService,
      vi.fn(),
      vi.fn(),
      async chain => `${chain}-address`,
      chain => (chain === Chain.Ethereum ? [token] : []),
      () => ({ [Chain.Ethereum]: [token] }),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn()
    )

  it('batches native + token balances for an EVM chain into a single multicall', async () => {
    const ethAddress = `${Chain.Ethereum}-address`
    vi.mocked(getEvmChainBalances).mockResolvedValue({
      [accountCoinKeyToString({ chain: Chain.Ethereum, address: ethAddress })]: 1_000_000_000_000_000_000n,
      [accountCoinKeyToString({ chain: Chain.Ethereum, id: token.id, address: ethAddress })]: 5_000_000n,
    })
    vi.mocked(getCoinBalance).mockResolvedValue(100_000_000n)

    const service = makeService()

    const result = await service.getBalances({
      chains: [Chain.Ethereum, Chain.Bitcoin],
      includeTokens: true,
    })

    // ONE multicall for the whole EVM chain (native + token), not one RPC per coin.
    expect(getEvmChainBalances).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getEvmChainBalances).mock.calls[0][0]).toEqual({
      chain: Chain.Ethereum,
      address: ethAddress,
      coins: [
        { chain: Chain.Ethereum, address: ethAddress },
        { chain: Chain.Ethereum, id: token.id, address: ethAddress },
      ],
    })

    // Non-EVM chain (Bitcoin) still uses the per-coin path — native only.
    expect(getCoinBalance).toHaveBeenCalledTimes(1)
    expect(vi.mocked(getCoinBalance).mock.calls.map(([input]) => [input.chain, input.id])).toEqual([
      [Chain.Bitcoin, undefined],
    ])

    expect(result[Chain.Ethereum]?.formattedAmount).toBe('1')
    expect(result[`${Chain.Ethereum}:${token.id}`]?.formattedAmount).toBe('5')
    expect(result[Chain.Bitcoin]?.formattedAmount).toBe('1')
  })

  it('serves cached EVM balances without re-multicalling', async () => {
    const ethAddress = `${Chain.Ethereum}-address`
    vi.mocked(getEvmChainBalances).mockResolvedValue({
      [accountCoinKeyToString({ chain: Chain.Ethereum, address: ethAddress })]: 1_000_000_000_000_000_000n,
      [accountCoinKeyToString({ chain: Chain.Ethereum, id: token.id, address: ethAddress })]: 5_000_000n,
    })

    const service = makeService()

    // First call warms the balance cache for native + token.
    await service.getBalances({ chains: [Chain.Ethereum], includeTokens: true })
    await flushMicrotasks()

    // Second identical call is fully cache-served — no additional multicall.
    const cached = await service.getBalances({ chains: [Chain.Ethereum], includeTokens: true })

    expect(getEvmChainBalances).toHaveBeenCalledTimes(1)
    expect(cached[Chain.Ethereum]?.formattedAmount).toBe('1')
    expect(cached[`${Chain.Ethereum}:${token.id}`]?.formattedAmount).toBe('5')
  })
})
