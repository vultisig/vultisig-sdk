import { Chain } from '@vultisig/core-chain/Chain'
import { knownTokens, knownTokensIndex } from '@vultisig/core-chain/coin/knownTokens'
import { describe, expect, it } from 'vitest'

// PR #562 (2026-05-25): added USDT + USDC on Polkadot Asset Hub (parachain 1000)
// to the knownTokens fast-path registry. Asset Hub uses pallet_assets with integer
// asset_id instead of contract addresses:
//   USDT: asset_id 1984 (on-chain symbol "USDt", normalised to "USDT")
//   USDC: asset_id 1337
// This suite pins the canonical entries so they survive future refactors.
// Decimals verified live via state_getStorage on Assets.Metadata at 2026-05-25.

const POLKADOT_USDT_ID = '1984'
const POLKADOT_USDC_ID = '1337'

describe('knownTokens — Polkadot Asset Hub (PR #562)', () => {
  // knownTokens[chain] is a KnownCoin[] (array). knownTokensIndex[chain]
  // is the lowercased-key map that consumers use for lookups. Both are
  // derived from the same leanTokens source — testing both pins the contract.

  describe('USDT (asset_id 1984)', () => {
    it('is reachable via knownTokensIndex (the canonical lookup API)', () => {
      const fromIndex = knownTokensIndex[Chain.Polkadot][POLKADOT_USDT_ID.toLowerCase()]
      expect(fromIndex).toBeDefined()
      expect(fromIndex.ticker).toBe('USDT')
      expect(fromIndex.decimals).toBe(6)
      expect(fromIndex.priceProviderId).toBe('tether')
    })

    it('appears in the knownTokens[Polkadot] array', () => {
      const usdt = knownTokens[Chain.Polkadot].find(c => c.id === POLKADOT_USDT_ID)
      expect(usdt).toBeDefined()
      expect(usdt!.ticker).toBe('USDT')
    })

    it('has a non-empty logo', () => {
      const usdt = knownTokens[Chain.Polkadot].find(c => c.id === POLKADOT_USDT_ID)
      expect(usdt!.logo).toBeTruthy()
    })
  })

  describe('USDC (asset_id 1337)', () => {
    it('is reachable via knownTokensIndex (the canonical lookup API)', () => {
      const fromIndex = knownTokensIndex[Chain.Polkadot][POLKADOT_USDC_ID.toLowerCase()]
      expect(fromIndex).toBeDefined()
      expect(fromIndex.ticker).toBe('USDC')
      expect(fromIndex.decimals).toBe(6)
      expect(fromIndex.priceProviderId).toBe('usd-coin')
    })

    it('appears in the knownTokens[Polkadot] array', () => {
      const usdc = knownTokens[Chain.Polkadot].find(c => c.id === POLKADOT_USDC_ID)
      expect(usdc).toBeDefined()
      expect(usdc!.ticker).toBe('USDC')
    })

    it('has a non-empty logo', () => {
      const usdc = knownTokens[Chain.Polkadot].find(c => c.id === POLKADOT_USDC_ID)
      expect(usdc!.logo).toBeTruthy()
    })
  })

  describe('knownTokensIndex lookup by asset_id', () => {
    it('USDT lookup { chain: Polkadot, id: "1984" } returns the USDT entry', () => {
      const entry = knownTokensIndex[Chain.Polkadot][POLKADOT_USDT_ID]
      expect(entry).toBeDefined()
      expect(entry.id).toBe(POLKADOT_USDT_ID)
      expect(entry.ticker).toBe('USDT')
      expect(entry.chain).toBe(Chain.Polkadot)
    })

    it('USDC lookup { chain: Polkadot, id: "1337" } returns the USDC entry', () => {
      const entry = knownTokensIndex[Chain.Polkadot][POLKADOT_USDC_ID]
      expect(entry).toBeDefined()
      expect(entry.id).toBe(POLKADOT_USDC_ID)
      expect(entry.ticker).toBe('USDC')
      expect(entry.chain).toBe(Chain.Polkadot)
    })
  })

  describe('Polkadot token list sanity', () => {
    it('has at least 2 entries (USDT + USDC)', () => {
      expect(knownTokens[Chain.Polkadot].length).toBeGreaterThanOrEqual(2)
    })

    it('USDT and USDC are distinct entries', () => {
      const usdt = knownTokens[Chain.Polkadot].find(c => c.id === POLKADOT_USDT_ID)
      const usdc = knownTokens[Chain.Polkadot].find(c => c.id === POLKADOT_USDC_ID)
      expect(usdt).not.toBe(usdc)
    })
  })
})
