import { Chain } from '@vultisig/core-chain/Chain'
import { knownTokens, knownTokensIndex } from '@vultisig/core-chain/coin/knownTokens'
import { describe, expect, it } from 'vitest'

// QA dogfood Bug J (paaao 2026-05-02): the knownTokens fast-path
// registry was missing USDC + USDT on Solana, forcing every "USDC
// on Solana" reference through CoinGecko fallback (slow + flaky).
// EVM chains had Circle USDC hard-coded via the shared `usdc` const;
// Solana didn't. This suite pins the canonical SPL mints in the
// registry so they survive future refactors.
//
// Mints are public, well-known, ratified by issuer:
//   USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v (Circle)
//   USDT: Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB (Tether)

const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SOLANA_USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'

describe('knownTokens — Solana SPL fast-path (Bug J)', () => {
  // knownTokens[chain] is a KnownCoin[] (array). knownTokensIndex[chain]
  // is the lowercased-key map that consumers use for lookups (see e.g.
  // packages/core/chain/swap/native/utils/getNativeSwapDecimals.ts:23).
  // Both are derived from the same leanTokens source — checking either
  // proves the entries land. Tests below use both to pin the contract.

  describe('USDC', () => {
    it('is reachable via knownTokensIndex (the canonical lookup API)', () => {
      const fromIndex = knownTokensIndex[Chain.Solana][SOLANA_USDC_MINT.toLowerCase()]
      expect(fromIndex).toBeDefined()
      expect(fromIndex.ticker).toBe('USDC')
      expect(fromIndex.decimals).toBe(6)
      expect(fromIndex.priceProviderId).toBe('usd-coin')
    })

    it('appears in the knownTokens[Solana] array', () => {
      const usdc = knownTokens[Chain.Solana].find(c => c.id === SOLANA_USDC_MINT)
      expect(usdc).toBeDefined()
      expect(usdc!.ticker).toBe('USDC')
    })
  })

  describe('USDT', () => {
    it('is reachable via knownTokensIndex (the canonical lookup API)', () => {
      const fromIndex = knownTokensIndex[Chain.Solana][SOLANA_USDT_MINT.toLowerCase()]
      expect(fromIndex).toBeDefined()
      expect(fromIndex.ticker).toBe('USDT')
      expect(fromIndex.decimals).toBe(6)
      expect(fromIndex.priceProviderId).toBe('tether')
    })

    it('appears in the knownTokens[Solana] array', () => {
      const usdt = knownTokens[Chain.Solana].find(c => c.id === SOLANA_USDT_MINT)
      expect(usdt).toBeDefined()
      expect(usdt!.ticker).toBe('USDT')
    })
  })

  describe('coexistence with pre-existing Solana entries', () => {
    // JUP and USDS were already present pre-Bug-J. Pin that the new
    // additions didn't displace them (would happen if the spread/order
    // got refactored wrong).
    it('JUP entry preserved', () => {
      const jup = knownTokens[Chain.Solana].find(c => c.id === 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN')
      expect(jup).toBeDefined()
      expect(jup!.ticker).toBe('JUP')
    })

    it('USDS entry preserved', () => {
      const usds = knownTokens[Chain.Solana].find(c => c.id === 'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA')
      expect(usds).toBeDefined()
      expect(usds!.ticker).toBe('USDS')
    })

    it('Solana token list has at least 4 entries (USDC + USDT + JUP + USDS)', () => {
      expect(knownTokens[Chain.Solana].length).toBeGreaterThanOrEqual(4)
    })
  })

  // Defensive shape check: the LLM is told to copy Solana addresses
  // VERBATIM (case-sensitive base58, prompt.go:167). Verify the mint
  // ids in the source map match the issuer's canonical case so a
  // future refactor can't accidentally lowercase them.
  describe('canonical case preserved in source ids', () => {
    it('USDC mint id matches Circle canonical case', () => {
      const usdc = knownTokens[Chain.Solana].find(c => c.id.toLowerCase() === SOLANA_USDC_MINT.toLowerCase())
      expect(usdc?.id).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
    })

    it('USDT mint id matches Tether canonical case', () => {
      const usdt = knownTokens[Chain.Solana].find(c => c.id.toLowerCase() === SOLANA_USDT_MINT.toLowerCase())
      expect(usdt?.id).toBe('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')
    })
  })
})
