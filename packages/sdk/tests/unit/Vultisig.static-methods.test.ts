import { Chain } from '@core/chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Only mock async/network-dependent core modules
// DO NOT mock static data modules (chainFeeCoin, knownTokens) as they have
// transitive dependencies that break at module load time
vi.mock('@core/chain/coin/price/getCoinPrices', () => ({
  getCoinPrices: vi.fn(),
}))

vi.mock('@core/chain/security/blockaid/site', () => ({
  scanSiteWithBlockaid: vi.fn(),
}))

import { getCoinPrices } from '@core/chain/coin/price/getCoinPrices'
import { scanSiteWithBlockaid } from '@core/chain/security/blockaid/site'

import { Vultisig } from '../../src/Vultisig'

describe('Vultisig static methods', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getKnownTokens', () => {
    it('should return known tokens for Ethereum', () => {
      const tokens = Vultisig.getKnownTokens(Chain.Ethereum)

      expect(Array.isArray(tokens)).toBe(true)
      expect(tokens.length).toBeGreaterThan(0)
    })

    it('should return SDK-owned TokenInfo shape (contractAddress not id)', () => {
      const tokens = Vultisig.getKnownTokens(Chain.Ethereum)

      const token = tokens[0]
      expect(token).toHaveProperty('contractAddress')
      expect(token).toHaveProperty('chain')
      expect(token).toHaveProperty('ticker')
      expect(token).toHaveProperty('decimals')
      // Should NOT have core's `id` field
      expect(token).not.toHaveProperty('id')
    })

    it('should return empty array for chain with no known tokens', () => {
      // Bitcoin has no ERC-20/SPL tokens in the known tokens registry
      const tokens = Vultisig.getKnownTokens(Chain.Bitcoin)

      expect(tokens).toEqual([])
    })
  })

  describe('getKnownToken', () => {
    // USDC on Ethereum is a well-known stable token in the registry
    const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

    it('should return token info for a known contract address', () => {
      const token = Vultisig.getKnownToken(Chain.Ethereum, USDC_ADDRESS)

      expect(token).not.toBeNull()
      expect(token!.ticker).toBe('USDC')
      expect(token!.decimals).toBe(6)
      expect(token!.chain).toBe(Chain.Ethereum)
    })

    it('should be case-insensitive for contract address lookup', () => {
      const token = Vultisig.getKnownToken(Chain.Ethereum, USDC_ADDRESS.toLowerCase())

      expect(token).not.toBeNull()
      expect(token!.ticker).toBe('USDC')
    })

    it('should return null for unknown contract address', () => {
      const token = Vultisig.getKnownToken(Chain.Ethereum, '0x0000000000000000000000000000000000000000')

      expect(token).toBeNull()
    })

    it('should return null for chain with no known tokens', () => {
      const token = Vultisig.getKnownToken(Chain.Bitcoin, '0x123')

      expect(token).toBeNull()
    })
  })

  describe('getFeeCoin', () => {
    it('should return fee coin info for Bitcoin', () => {
      const feeCoin = Vultisig.getFeeCoin(Chain.Bitcoin)

      expect(feeCoin.chain).toBe(Chain.Bitcoin)
      expect(feeCoin.ticker).toBe('BTC')
      expect(feeCoin.decimals).toBe(8)
      expect(feeCoin).toHaveProperty('logo')
    })

    it('should return fee coin info for Ethereum', () => {
      const feeCoin = Vultisig.getFeeCoin(Chain.Ethereum)

      expect(feeCoin.chain).toBe(Chain.Ethereum)
      expect(feeCoin.ticker).toBe('ETH')
      expect(feeCoin.decimals).toBe(18)
    })

    it('should always include chain in the returned FeeCoinInfo', () => {
      const feeCoin = Vultisig.getFeeCoin(Chain.Solana)

      expect(feeCoin.chain).toBe(Chain.Solana)
      expect(feeCoin.ticker).toBe('SOL')
    })
  })

  describe('getCoinPrices', () => {
    it('should fetch prices for given token IDs', async () => {
      vi.mocked(getCoinPrices).mockResolvedValue({ bitcoin: 50000, ethereum: 3000 })

      const result = await Vultisig.getCoinPrices({ ids: ['bitcoin', 'ethereum'] })

      expect(result).toEqual({ bitcoin: 50000, ethereum: 3000 })
      expect(getCoinPrices).toHaveBeenCalledWith({
        ids: ['bitcoin', 'ethereum'],
        fiatCurrency: 'usd',
      })
    })

    it('should use custom fiat currency when specified', async () => {
      vi.mocked(getCoinPrices).mockResolvedValue({ bitcoin: 45000 })

      await Vultisig.getCoinPrices({ ids: ['bitcoin'], fiatCurrency: 'eur' })

      expect(getCoinPrices).toHaveBeenCalledWith({
        ids: ['bitcoin'],
        fiatCurrency: 'eur',
      })
    })

    it('should default to USD when no fiat currency specified', async () => {
      vi.mocked(getCoinPrices).mockResolvedValue({})

      await Vultisig.getCoinPrices({ ids: [] })

      expect(getCoinPrices).toHaveBeenCalledWith({
        ids: [],
        fiatCurrency: 'usd',
      })
    })
  })

  describe('getBanxaSupportedChains', () => {
    it('should return array of supported chains', () => {
      const chains = Vultisig.getBanxaSupportedChains()

      expect(Array.isArray(chains)).toBe(true)
      expect(chains.length).toBeGreaterThan(0)
      // Known Banxa-supported chains
      expect(chains).toContain(Chain.Bitcoin)
      expect(chains).toContain(Chain.Ethereum)
    })

    it('should return a copy (not a reference to internal array)', () => {
      const chains1 = Vultisig.getBanxaSupportedChains()
      const chains2 = Vultisig.getBanxaSupportedChains()

      expect(chains1).toEqual(chains2)
      expect(chains1).not.toBe(chains2)
    })
  })

  describe('scanSite', () => {
    it('should return malicious result for malicious sites', async () => {
      vi.mocked(scanSiteWithBlockaid).mockResolvedValue('malicious')

      const result = await Vultisig.scanSite('https://evil-phishing.com')

      expect(result).toEqual({
        isMalicious: true,
        url: 'https://evil-phishing.com',
      })
      expect(scanSiteWithBlockaid).toHaveBeenCalledWith('https://evil-phishing.com')
    })

    it('should return safe result for non-malicious sites', async () => {
      vi.mocked(scanSiteWithBlockaid).mockResolvedValue(null)

      const result = await Vultisig.scanSite('https://safe-site.com')

      expect(result).toEqual({
        isMalicious: false,
        url: 'https://safe-site.com',
      })
    })
  })
})
