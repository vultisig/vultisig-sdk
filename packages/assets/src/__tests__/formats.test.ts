import { describe, expect, it } from 'vitest'

import {
  buildFinFormat,
  buildThorchainFormat,
  convertFormat,
  detectFormat,
  extractChainFromThorchain,
  extractContractFromThorchain,
  extractSymbolFromThorchain,
  parseAsset,
  toFinFormat,
  toL1Format,
  toThorchainFormat,
} from '../formats.js'
import { getAsset } from '../registry.js'

describe('Format Converters', () => {
  const btc = getAsset('btc')!
  const usdc = getAsset('usdc_eth')!
  const eth = getAsset('eth')!
  const rune = getAsset('rune')!
  const ruji = getAsset('ruji')!
  const auto = getAsset('auto')!

  describe('format conversion', () => {
    it('should convert to THORChain format', () => {
      expect(toThorchainFormat(btc)).toBe('BTC.BTC')
      expect(toThorchainFormat(usdc)).toBe('ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48')
      expect(toThorchainFormat(eth)).toBe('ETH.ETH')
      expect(toThorchainFormat(rune)).toBe('THOR.RUNE')
      expect(toThorchainFormat(ruji)).toBe('THOR.RUJI')
    })

    it('should convert to FIN format (corrected)', () => {
      // Fixed FIN formats with THORChain identifiers
      expect(toFinFormat(btc)).toBe('btc-btc')
      expect(toFinFormat(eth)).toBe('eth-eth')
      expect(toFinFormat(usdc)).toBe('eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')

      // Special FIN formats for THORChain tokens
      expect(toFinFormat(rune)).toBe('rune')
      expect(toFinFormat(ruji)).toBe('x/ruji')
      expect(toFinFormat(auto)).toBe('thor.auto')
    })

    it('should convert to L1 format', () => {
      expect(toL1Format(btc)).toBe('BTC')
      expect(toL1Format(usdc)).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
      expect(toL1Format(eth)).toBe('ETH')
      expect(toL1Format(rune)).toBe('RUNE')
    })
  })

  describe('asset parsing', () => {
    it('should parse BTC from various formats', () => {
      expect(parseAsset('BTC')?.id).toBe('btc')
      expect(parseAsset('btc.btc')?.id).toBe('btc')
      expect(parseAsset('btc-btc')?.id).toBe('btc') // Fixed FIN format
    })

    it('should parse USDC from various formats', () => {
      expect(parseAsset('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')?.id).toBe('usdc_eth')
      expect(parseAsset('ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48')?.id).toBe('usdc_eth')
      expect(parseAsset('eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')?.id).toBe('usdc_eth')
    })

    it('should parse THORChain tokens with special FIN formats', () => {
      expect(parseAsset('rune')?.id).toBe('rune')
      expect(parseAsset('x/ruji')?.id).toBe('ruji')
      expect(parseAsset('thor.auto')?.id).toBe('auto')
      expect(parseAsset('thor.lqdy')?.id).toBe('lqdy')
    })

    it('should parse other L1 assets', () => {
      expect(parseAsset('gaia-atom')?.id).toBe('atom') // Fixed format
      expect(parseAsset('bsc-bnb')?.id).toBe('bnb') // Fixed format
      expect(parseAsset('avax-avax')?.id).toBe('avax')
      expect(parseAsset('xrp-xrp')?.id).toBe('xrp')
    })

    it('should return null for unknown assets', () => {
      expect(parseAsset('UNKNOWN')).toBeNull()
      expect(parseAsset('fake-token')).toBeNull()
      // Old wrong FIN formats should not work
      expect(parseAsset('bitcoin-btc')).toBeNull()
      expect(parseAsset('ethereum-eth')).toBeNull()
    })
  })

  describe('format detection', () => {
    it('should detect THORChain format', () => {
      expect(detectFormat('BTC.BTC')).toBe('thorchain')
      expect(detectFormat('ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48')).toBe('thorchain')
      expect(detectFormat('THOR.RUNE')).toBe('thorchain')
      expect(detectFormat('GAIA.ATOM')).toBe('thorchain')
    })

    it('should detect FIN format (including special formats)', () => {
      // Standard FIN formats
      expect(detectFormat('btc-btc')).toBe('fin')
      expect(detectFormat('eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe('fin')

      // Special FIN formats
      expect(detectFormat('rune')).toBe('fin')
      expect(detectFormat('tcy')).toBe('fin')
      expect(detectFormat('x/ruji')).toBe('fin')
      expect(detectFormat('thor.auto')).toBe('fin')
      expect(detectFormat('thor.lqdy')).toBe('fin')
    })

    it('should detect L1 format', () => {
      expect(detectFormat('BTC')).toBe('l1')
      expect(detectFormat('ETH')).toBe('l1')
      expect(detectFormat('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe('l1')
    })

    it('should detect unknown format', () => {
      expect(detectFormat('invalid-format-123-456')).toBe('unknown')
      expect(detectFormat('')).toBe('unknown')
      expect(detectFormat('bitcoin-btc')).toBe('unknown') // Old wrong format
    })
  })

  describe('format conversion', () => {
    it('should convert between formats', () => {
      expect(convertFormat('BTC', 'thorchain')).toBe('BTC.BTC')
      expect(convertFormat('BTC.BTC', 'fin')).toBe('btc-btc')
      expect(convertFormat('btc-btc', 'l1')).toBe('BTC')
    })

    it('should convert special FIN formats', () => {
      expect(convertFormat('rune', 'thorchain')).toBe('THOR.RUNE')
      expect(convertFormat('x/ruji', 'thorchain')).toBe('THOR.RUJI')
      expect(convertFormat('thor.auto', 'l1')).toBe('AUTO')
    })

    it('should convert multi-chain assets', () => {
      expect(convertFormat('usdc_eth', 'fin')).toBe('eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
      expect(convertFormat('usdc_base', 'fin')).toBe('base-usdc-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
    })

    it('should return null for unknown assets', () => {
      expect(convertFormat('UNKNOWN', 'thorchain')).toBeNull()
    })
  })

  describe('THORChain parsing', () => {
    it('should extract chain from THORChain format', () => {
      expect(extractChainFromThorchain('BTC.BTC')).toBe('bitcoin')
      expect(extractChainFromThorchain('ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48')).toBe('ethereum')
      expect(extractChainFromThorchain('THOR.RUNE')).toBe('thorchain')
      expect(extractChainFromThorchain('GAIA.ATOM')).toBe('cosmos')
      expect(extractChainFromThorchain('BASE.ETH')).toBe('base')
      expect(extractChainFromThorchain('XRP.XRP')).toBe('xrp')
    })

    it('should extract symbol from THORChain format', () => {
      expect(extractSymbolFromThorchain('BTC.BTC')).toBe('BTC')
      expect(extractSymbolFromThorchain('ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48')).toBe('USDC')
      expect(extractSymbolFromThorchain('THOR.RUNE')).toBe('RUNE')
    })

    it('should extract contract from THORChain format', () => {
      expect(extractContractFromThorchain('BTC.BTC')).toBeUndefined()
      expect(extractContractFromThorchain('ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48')).toBe(
        '0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48'
      )
      expect(extractContractFromThorchain('BASE.CBBTC-0XCBB7C0000AB88B473B1F5AFD9EF808440EED33BF')).toBe(
        '0XCBB7C0000AB88B473B1F5AFD9EF808440EED33BF'
      )
    })
  })

  describe('format building', () => {
    it('should build THORChain format', () => {
      expect(buildThorchainFormat('btc', 'btc')).toBe('BTC.BTC')
      expect(buildThorchainFormat('eth', 'usdc', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(
        'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48'
      )
      expect(buildThorchainFormat('thor', 'rune')).toBe('THOR.RUNE')
    })

    it('should build FIN format (corrected)', () => {
      // Use correct THORChain identifiers
      expect(buildFinFormat('btc', 'btc')).toBe('btc-btc')
      expect(buildFinFormat('eth', 'usdc', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(
        'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
      )
      expect(buildFinFormat('gaia', 'atom')).toBe('gaia-atom')
      expect(buildFinFormat('bsc', 'bnb')).toBe('bsc-bnb')
    })
  })

  describe('comprehensive format testing', () => {
    it('should handle all asset types correctly', () => {
      const testCases = [
        { id: 'btc', l1: 'BTC', thor: 'BTC.BTC', fin: 'btc-btc' },
        { id: 'eth', l1: 'ETH', thor: 'ETH.ETH', fin: 'eth-eth' },
        { id: 'atom', l1: 'ATOM', thor: 'GAIA.ATOM', fin: 'gaia-atom' },
        { id: 'rune', l1: 'RUNE', thor: 'THOR.RUNE', fin: 'rune' },
        { id: 'ruji', l1: 'RUJI', thor: 'THOR.RUJI', fin: 'x/ruji' },
        { id: 'auto', l1: 'AUTO', thor: 'THOR.AUTO', fin: 'thor.auto' },
      ]

      for (const testCase of testCases) {
        const asset = getAsset(testCase.id)
        if (asset) {
          expect(toL1Format(asset)).toBe(testCase.l1)
          expect(toThorchainFormat(asset)).toBe(testCase.thor)
          expect(toFinFormat(asset)).toBe(testCase.fin)

          // Test reverse parsing
          expect(parseAsset(testCase.l1)?.id).toBe(testCase.id)
          expect(parseAsset(testCase.thor)?.id).toBe(testCase.id)
          expect(parseAsset(testCase.fin)?.id).toBe(testCase.id)
        }
      }
    })
  })
})
