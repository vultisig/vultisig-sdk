import { describe, expect, it } from 'vitest'

import { Chain } from '../../../Chain'
import { resolveTokenPriceId } from '../resolveTokenPriceId'

describe('resolveTokenPriceId', () => {
  describe('native chain coin (no denomOrAddress)', () => {
    it('Ethereum -> ethereum', () => {
      expect(resolveTokenPriceId(Chain.Ethereum)).toBe('ethereum')
    })

    it('Bitcoin -> bitcoin', () => {
      expect(resolveTokenPriceId(Chain.Bitcoin)).toBe('bitcoin')
    })

    it('TerraClassic -> terra-luna', () => {
      expect(resolveTokenPriceId(Chain.TerraClassic)).toBe('terra-luna')
    })

    it('Terra -> terra-luna-2', () => {
      expect(resolveTokenPriceId(Chain.Terra)).toBe('terra-luna-2')
    })

    it('THORChain -> thorchain', () => {
      expect(resolveTokenPriceId(Chain.THORChain)).toBe('thorchain')
    })

    it('Solana -> solana', () => {
      expect(resolveTokenPriceId(Chain.Solana)).toBe('solana')
    })

    it('Ton -> the-open-network', () => {
      expect(resolveTokenPriceId(Chain.Ton)).toBe('the-open-network')
    })

    it('Cosmos -> cosmos', () => {
      expect(resolveTokenPriceId(Chain.Cosmos)).toBe('cosmos')
    })

    it('Avalanche -> avalanche-2', () => {
      expect(resolveTokenPriceId(Chain.Avalanche)).toBe('avalanche-2')
    })

    it('BSC -> binancecoin', () => {
      expect(resolveTokenPriceId(Chain.BSC)).toBe('binancecoin')
    })
  })

  describe('curated tokens (denomOrAddress provided)', () => {
    it('USDC on Ethereum -> usd-coin', () => {
      expect(resolveTokenPriceId(Chain.Ethereum, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')).toBe('usd-coin')
    })

    it('USDC lookup on Ethereum is case-insensitive (uppercase contract)', () => {
      expect(resolveTokenPriceId(Chain.Ethereum, '0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48')).toBe('usd-coin')
    })

    it('USDC lookup on Ethereum is case-insensitive (lowercase contract)', () => {
      expect(resolveTokenPriceId(Chain.Ethereum, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe('usd-coin')
    })

    it('VULT on Ethereum -> vultisig', () => {
      expect(resolveTokenPriceId(Chain.Ethereum, '0xb788144DF611029C60b859DF47e79B7726C4DEBa')).toBe('vultisig')
    })

    it('USDT on Ethereum -> tether', () => {
      expect(resolveTokenPriceId(Chain.Ethereum, '0xdac17f958d2ee523a2206206994597c13d831ec7')).toBe('tether')
    })

    it('Solana USDC mint -> usd-coin (case-insensitive lookup into lowercased index)', () => {
      // The index stores keys lowercased; passing the canonical mixed-case mint works fine
      expect(resolveTokenPriceId(Chain.Solana, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe('usd-coin')
    })

    it('Solana USDT mint -> tether', () => {
      expect(resolveTokenPriceId(Chain.Solana, 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')).toBe('tether')
    })

    it('TerraClassic uusd -> terrausd', () => {
      expect(resolveTokenPriceId(Chain.TerraClassic, 'uusd')).toBe('terrausd')
    })

    it('TON USDT jetton -> tether', () => {
      // EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs
      expect(resolveTokenPriceId(Chain.Ton, 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs')).toBe('tether')
    })

    it('Arbitrum USDC -> usd-coin', () => {
      expect(resolveTokenPriceId(Chain.Arbitrum, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831')).toBe('usd-coin')
    })
  })

  describe('unknown / unsupported', () => {
    it('unknown contract on Ethereum -> undefined', () => {
      expect(resolveTokenPriceId(Chain.Ethereum, '0x0000000000000000000000000000000000000000')).toBeUndefined()
    })

    it('unknown denom on TerraClassic -> undefined', () => {
      expect(resolveTokenPriceId(Chain.TerraClassic, 'krtc')).toBeUndefined()
    })

    it('uluna on TerraClassic -> undefined (only in chainFeeCoin, not knownTokensIndex)', () => {
      // uluna is the native denom but it is not registered as a separate knownToken entry
      expect(resolveTokenPriceId(Chain.TerraClassic, 'uluna')).toBeUndefined()
    })

    it('unknown Solana mint -> undefined', () => {
      expect(resolveTokenPriceId(Chain.Solana, 'So11111111111111111111111111111111111111112')).toBeUndefined()
    })
  })
})
