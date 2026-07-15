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

  it('does NOT cache or emit a coin the multicall omitted, and refetches it next call (#1191)', async () => {
    const ethAddress = `${Chain.Ethereum}-address`
    const nativeKey = accountCoinKeyToString({ chain: Chain.Ethereum, address: ethAddress })
    const tokenKey = accountCoinKeyToString({ chain: Chain.Ethereum, id: token.id, address: ethAddress })
    // Multicall returns native but OMITS the token (a transient partial-aggregate / RPC hiccup).
    vi.mocked(getEvmChainBalances).mockResolvedValue({
      [nativeKey]: 1_000_000_000_000_000_000n,
    })

    const emitBalanceUpdated = vi.fn()
    const service = new BalanceService(
      cacheService,
      emitBalanceUpdated,
      vi.fn(),
      async chain => `${chain}-address`,
      chain => (chain === Chain.Ethereum ? [token] : []),
      () => ({ [Chain.Ethereum]: [token] }),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn()
    )

    const first = await service.getBalances({ chains: [Chain.Ethereum], includeTokens: true })
    await flushMicrotasks()

    // Native (present) is returned; the omitted token is returned transiently for shape completeness...
    expect(first[Chain.Ethereum]?.formattedAmount).toBe('1')
    // ...but the omitted token is NEVER emitted as a real balance (only the present native fired).
    const emittedTokenIds = emitBalanceUpdated.mock.calls.map(([d]) => d.tokenId)
    expect(emittedTokenIds).toContain(undefined) // native
    expect(emittedTokenIds).not.toContain(token.id) // omitted token must not emit a phantom 0

    // The omitted token was NOT cached — a second call re-multicalls (native is cache-served, token refetches).
    vi.mocked(getEvmChainBalances).mockResolvedValue({
      [nativeKey]: 1_000_000_000_000_000_000n,
      [tokenKey]: 5_000_000n,
    })
    const second = await service.getBalances({ chains: [Chain.Ethereum], includeTokens: true })

    expect(getEvmChainBalances).toHaveBeenCalledTimes(2) // refetched because the token was never cached
    expect(second[`${Chain.Ethereum}:${token.id}`]?.formattedAmount).toBe('5') // real value on refetch
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
