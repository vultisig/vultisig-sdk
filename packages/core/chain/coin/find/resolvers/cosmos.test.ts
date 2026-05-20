import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAllBalancesMock = vi.fn()
// #428 codex-adversarial M2: stub getCosmosTokenMetadata so the unit
// tests don't depend on network behavior. The fallback ticker path is
// what we're pinning; we want the metadata branch to fail
// deterministically (rejected promise -> .catch in resolver -> ticker
// undefined -> fallback fires).
const getCosmosTokenMetadataMock = vi.fn()

vi.mock('@vultisig/core-chain/chains/cosmos/client', () => ({
  getCosmosClient: () => ({
    getAllBalances: getAllBalancesMock,
  }),
}))

vi.mock('@vultisig/core-chain/coin/token/metadata/resolvers/cosmos', () => ({
  getCosmosTokenMetadata: (...args: unknown[]) => getCosmosTokenMetadataMock(...args),
}))

import { Chain } from '../../../Chain'
import { findCosmosCoins } from './cosmos'

describe('findCosmosCoins', () => {
  beforeEach(() => {
    getAllBalancesMock.mockReset()
    getCosmosTokenMetadataMock.mockReset()
  })

  it('keeps known single-segment THORChain denoms like TCY', async () => {
    getAllBalancesMock.mockResolvedValue([
      { denom: 'rune', amount: '1' },
      { denom: 'tcy', amount: '2' },
    ])
    // metadata path fails -> resolver falls back to denom.split('/').at(-1)
    getCosmosTokenMetadataMock.mockRejectedValue(new Error('no metadata'))

    const coins = await findCosmosCoins({
      address: 'thor1address',
      chain: Chain.THORChain,
    })

    expect(coins).toEqual([
      expect.objectContaining({
        id: 'tcy',
        decimals: 8,
        ticker: 'TCY',
        logo: 'tcy',
      }),
    ])
  })

  // #428: factory/{addr}/{subdenom} shaped denoms must resolve to the
  // subdenom as the ticker, NOT the creator address. The previous
  // [1]?.toUpperCase() picked the second segment (the address), so we'd
  // ship the creator's bech32 as the user-visible ticker. .at(-1) covers
  // 1/2/3-segment denom shapes uniformly.
  it('extracts the subdenom for 3-segment factory/ denoms (closes #428)', async () => {
    getAllBalancesMock.mockResolvedValue([
      { denom: 'rune', amount: '1' },
      { denom: 'factory/thor1xyz0000000000000000000000000000000000/usdc', amount: '5' },
    ])
    getCosmosTokenMetadataMock.mockRejectedValue(new Error('no metadata'))

    const coins = await findCosmosCoins({
      address: 'thor1address',
      chain: Chain.THORChain,
    })

    expect(coins).toEqual([
      expect.objectContaining({
        id: 'factory/thor1xyz0000000000000000000000000000000000/usdc',
        ticker: 'USDC',
        logo: 'usdc',
      }),
    ])
  })

  // #428 codex-adversarial M1: only split on `/`, not `[-./]`. A factory
  // denom whose subdenom carries a dotted suffix like `usdc.v2` MUST keep
  // the suffix in the ticker (USDC.V2, not V2). Mirrors metadata
  // resolver's deriveTicker for factory/ denoms.
  it('preserves dotted suffix in factory/ subdenom (e.g. usdc.v2 -> USDC.V2)', async () => {
    getAllBalancesMock.mockResolvedValue([
      { denom: 'rune', amount: '1' },
      { denom: 'factory/thor1xyz0000000000000000000000000000000000/usdc.v2', amount: '5' },
    ])
    getCosmosTokenMetadataMock.mockRejectedValue(new Error('no metadata'))

    const coins = await findCosmosCoins({
      address: 'thor1address',
      chain: Chain.THORChain,
    })

    expect(coins).toEqual([
      expect.objectContaining({
        id: 'factory/thor1xyz0000000000000000000000000000000000/usdc.v2',
        ticker: 'USDC.V2',
        logo: 'usdc.v2',
      }),
    ])
  })

  // #428 codex-adversarial M1: hyphenated tails (yield-bearing
  // factory tokens, e.g. yA-USDC) must NOT be split on `-`.
  it('preserves hyphenated subdenom (e.g. yA-USDC -> YA-USDC)', async () => {
    getAllBalancesMock.mockResolvedValue([
      { denom: 'rune', amount: '1' },
      { denom: 'factory/thor1xyz0000000000000000000000000000000000/yA-USDC', amount: '5' },
    ])
    getCosmosTokenMetadataMock.mockRejectedValue(new Error('no metadata'))

    const coins = await findCosmosCoins({
      address: 'thor1address',
      chain: Chain.THORChain,
    })

    expect(coins).toEqual([
      expect.objectContaining({
        id: 'factory/thor1xyz0000000000000000000000000000000000/yA-USDC',
        ticker: 'YA-USDC',
        logo: 'ya-usdc',
      }),
    ])
  })

  // #428: pin the 2-segment fallback path (the legacy happy case) — the
  // .at(-1) form must NOT regress denoms like `ibc/HASH...` etc.
  it('keeps 2-segment fallback denoms working (no regression vs [1])', async () => {
    getAllBalancesMock.mockResolvedValue([
      { denom: 'rune', amount: '1' },
      { denom: 'foo/bar', amount: '3' },
    ])
    getCosmosTokenMetadataMock.mockRejectedValue(new Error('no metadata'))

    const coins = await findCosmosCoins({
      address: 'thor1address',
      chain: Chain.THORChain,
    })

    expect(coins).toEqual([
      expect.objectContaining({
        id: 'foo/bar',
        ticker: 'BAR',
        logo: 'bar',
      }),
    ])
  })

  // #428 apotheosis CR: THORChain secured-asset shapes (`btc-btc`,
  // `eth-usdc-...`) contain no `/`, so a naive slash-last fallback
  // (`denom.split('/').at(-1)`) regresses their tickers - `btc-btc`
  // would surface as "BTC-BTC" instead of "BTC", `eth-usdc-arbitrum`
  // as "ETH-USDC-ARBITRUM" instead of "USDC". Tier 2 of the fallback
  // (legacy [-./] split, [1]) keeps these working.
  it('keeps THORChain secured-asset btc-btc fallback as BTC (apotheosis CR)', async () => {
    getAllBalancesMock.mockResolvedValue([
      { denom: 'rune', amount: '1' },
      { denom: 'btc-btc', amount: '4' },
    ])
    getCosmosTokenMetadataMock.mockRejectedValue(new Error('no metadata'))

    const coins = await findCosmosCoins({
      address: 'thor1address',
      chain: Chain.THORChain,
    })

    expect(coins).toEqual([
      expect.objectContaining({
        id: 'btc-btc',
        ticker: 'BTC',
        logo: 'btc',
      }),
    ])
  })

  it('keeps THORChain secured-asset eth-usdc-... fallback as USDC (apotheosis CR)', async () => {
    getAllBalancesMock.mockResolvedValue([
      { denom: 'rune', amount: '1' },
      { denom: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', amount: '4' },
    ])
    getCosmosTokenMetadataMock.mockRejectedValue(new Error('no metadata'))

    const coins = await findCosmosCoins({
      address: 'thor1address',
      chain: Chain.THORChain,
    })

    expect(coins).toEqual([
      expect.objectContaining({
        id: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        ticker: 'USDC',
        logo: 'usdc',
      }),
    ])
  })

  // #428 codex-adversarial note: explicitly pin the unknown-1-segment
  // behavior change. Old code returned undefined ticker -> coin dropped
  // (console.error). New code uses denom.toUpperCase() as fallback. This
  // is a strictly-better recovery path: if metadata returns nothing for a
  // bare denom, we still show SOMETHING the user can identify rather
  // than silently dropping the coin from balances.
  it('falls back to denom.toUpperCase() for unknown 1-segment denoms (was: dropped silently)', async () => {
    getAllBalancesMock.mockResolvedValue([
      { denom: 'rune', amount: '1' },
      { denom: 'mysterytoken', amount: '7' },
    ])
    getCosmosTokenMetadataMock.mockRejectedValue(new Error('no metadata'))

    const coins = await findCosmosCoins({
      address: 'thor1address',
      chain: Chain.THORChain,
    })

    expect(coins).toEqual([
      expect.objectContaining({
        id: 'mysterytoken',
        decimals: 8,
        ticker: 'MYSTERYTOKEN',
        logo: 'mysterytoken',
      }),
    ])
  })

  it('auto-discovers Terra Classic bank denoms with token metadata decimals', async () => {
    getAllBalancesMock.mockResolvedValue([
      { denom: 'uluna', amount: '1' },
      { denom: 'uusd', amount: '2' },
    ])
    getCosmosTokenMetadataMock.mockResolvedValue({
      ticker: 'USTC',
      decimals: 6,
      logo: 'ustc',
      priceProviderId: 'terrausd',
    })

    const coins = await findCosmosCoins({
      address: 'terra1address',
      chain: Chain.TerraClassic,
    })

    expect(getCosmosTokenMetadataMock).toHaveBeenCalledWith({
      chain: Chain.TerraClassic,
      id: 'uusd',
    })
    expect(coins).toEqual([
      expect.objectContaining({
        id: 'uusd',
        chain: Chain.TerraClassic,
        decimals: 6,
        ticker: 'USTC',
        logo: 'ustc',
        priceProviderId: 'terrausd',
      }),
    ])
  })

  it('uses metadata decimals for non-fee Terra denoms', async () => {
    getAllBalancesMock.mockResolvedValue([
      { denom: 'uluna', amount: '1' },
      { denom: 'ibc/NON6DECIMALS', amount: '2' },
    ])
    getCosmosTokenMetadataMock.mockResolvedValue({
      ticker: 'WETH',
      decimals: 18,
    })

    const coins = await findCosmosCoins({
      address: 'terra1address',
      chain: Chain.Terra,
    })

    expect(coins).toEqual([
      expect.objectContaining({
        id: 'ibc/NON6DECIMALS',
        decimals: 18,
        ticker: 'WETH',
      }),
    ])
  })

  it('marks Terra denoms without metadata as hidden instead of dropping them', async () => {
    getAllBalancesMock.mockResolvedValue([
      { denom: 'uluna', amount: '1' },
      { denom: 'factory/terra1creator/uspam', amount: '2' },
    ])
    getCosmosTokenMetadataMock.mockRejectedValue(new Error('no metadata'))

    const coins = await findCosmosCoins({
      address: 'terra1address',
      chain: Chain.Terra,
    })

    expect(coins).toEqual([
      expect.objectContaining({
        id: 'factory/terra1creator/uspam',
        decimals: 6,
        ticker: 'USPAM',
        isHidden: true,
      }),
    ])
  })

  it('propagates hidden metadata from IBC trace fallback', async () => {
    getAllBalancesMock.mockResolvedValue([
      { denom: 'uluna', amount: '1' },
      { denom: 'ibc/OSMOHASH', amount: '2' },
    ])
    getCosmosTokenMetadataMock.mockResolvedValue({
      ticker: 'osmo',
      decimals: 6,
      isHidden: true,
    })

    const coins = await findCosmosCoins({
      address: 'terra1address',
      chain: Chain.Terra,
    })

    expect(coins).toEqual([
      expect.objectContaining({
        id: 'ibc/OSMOHASH',
        ticker: 'OSMO',
        isHidden: true,
      }),
    ])
  })

  it('keeps non-allowlisted Cosmos chains disabled', async () => {
    getAllBalancesMock.mockResolvedValue([{ denom: 'uatom', amount: '1' }])

    await expect(
      findCosmosCoins({
        address: 'cosmos1address',
        chain: Chain.Cosmos,
      })
    ).resolves.toEqual([])
    expect(getAllBalancesMock).not.toHaveBeenCalled()
  })
})
