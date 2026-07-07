import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { isSkipRoutableChain, isTerraChain, willRouteViaSkip } from './skipRouting'

describe('isTerraChain', () => {
  it('is true for Terra v2 and TerraClassic only', () => {
    expect(isTerraChain(Chain.Terra)).toBe(true)
    expect(isTerraChain(Chain.TerraClassic)).toBe(true)
  })

  it('is false for every other chain, including other Skip-routable cosmos chains', () => {
    expect(isTerraChain(Chain.Cosmos)).toBe(false)
    expect(isTerraChain(Chain.Osmosis)).toBe(false)
    expect(isTerraChain(Chain.THORChain)).toBe(false)
    expect(isTerraChain(Chain.Ethereum)).toBe(false)
    expect(isTerraChain('NotAChain')).toBe(false)
  })
})

describe('isSkipRoutableChain', () => {
  it('is true for every Skip-indexed cosmos chain', () => {
    for (const chain of [
      Chain.Cosmos,
      Chain.Osmosis,
      Chain.Kujira,
      Chain.Terra,
      Chain.TerraClassic,
      Chain.Akash,
      Chain.Dydx,
      Chain.Noble,
    ]) {
      expect(isSkipRoutableChain(chain)).toBe(true)
    }
  })

  it('is false for THORChain/MayaChain (native providers, not Skip-indexed) and non-cosmos chains', () => {
    expect(isSkipRoutableChain(Chain.THORChain)).toBe(false)
    expect(isSkipRoutableChain(Chain.MayaChain)).toBe(false)
    expect(isSkipRoutableChain(Chain.Ethereum)).toBe(false)
    expect(isSkipRoutableChain(Chain.Bitcoin)).toBe(false)
    expect(isSkipRoutableChain('NotAChain')).toBe(false)
  })
})

describe('willRouteViaSkip', () => {
  it('routes both-sides-Skip-routable-cosmos pairs (ATOM<->OSMO)', () => {
    expect(willRouteViaSkip(Chain.Cosmos, Chain.Osmosis)).toBe(true)
    expect(willRouteViaSkip(Chain.Osmosis, Chain.Kujira)).toBe(true)
  })

  it('routes any pair touching Terra v2 or TerraClassic', () => {
    expect(willRouteViaSkip(Chain.Terra, Chain.Bitcoin)).toBe(true)
    expect(willRouteViaSkip(Chain.Ethereum, Chain.TerraClassic)).toBe(true)
    expect(willRouteViaSkip(Chain.Terra, Chain.THORChain)).toBe(true)
  })

  it('routes a Skip-routable-cosmos <-> Skip-supported-EVM cross pair for every allowlisted EVM chain (the #384-class bug: this branch was MISSING from abts list_swap_routes while execute_swap already had it)', () => {
    for (const evmChain of [
      Chain.Ethereum,
      Chain.Arbitrum,
      Chain.Optimism,
      Chain.Base,
      Chain.Polygon,
      Chain.Avalanche,
      Chain.BSC,
    ]) {
      expect(willRouteViaSkip(Chain.Cosmos, evmChain)).toBe(true)
      expect(willRouteViaSkip(evmChain, Chain.Kujira)).toBe(true)
    }
  })

  it('does NOT route a cosmos <-> EVM pair when the EVM chain is not Skip-supported', () => {
    expect(willRouteViaSkip(Chain.Cosmos, Chain.CronosChain)).toBe(false)
    expect(willRouteViaSkip(Chain.Zksync, Chain.Osmosis)).toBe(false)
  })

  it('does NOT route THORChain/MayaChain-native pairs (they have their own dedicated quote APIs, not Skip-indexed)', () => {
    expect(willRouteViaSkip(Chain.THORChain, Chain.Bitcoin)).toBe(false)
    expect(willRouteViaSkip(Chain.MayaChain, Chain.Ethereum)).toBe(false)
  })

  it('does NOT route a cross-family pair with no Skip/Terra involvement at all (stays on the general aggregator lane)', () => {
    expect(willRouteViaSkip(Chain.Bitcoin, Chain.Ethereum)).toBe(false)
    expect(willRouteViaSkip(Chain.Solana, Chain.Sui)).toBe(false)
  })

  it('fails closed to false for a genuinely-unknown/uncanonicalized chain string on either side', () => {
    expect(willRouteViaSkip('terra classic', Chain.Ethereum)).toBe(false)
    expect(willRouteViaSkip(Chain.Cosmos, 'notachain')).toBe(false)
  })
})
