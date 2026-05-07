import { describe, expect, it, vi } from 'vitest'

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
        ticker: 'MYSTERYTOKEN',
        logo: 'mysterytoken',
      }),
    ])
  })
})
