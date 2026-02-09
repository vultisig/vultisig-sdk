import { describe, it, expect } from 'vitest';
import { 
  KNOWN_ASSETS,
  getAsset,
  getAllAssets,
  findAssetByFormat,
  getAssetsByChain,
  getSupportedChains,
  getAssetStats
} from '../registry.js';

describe('Asset Registry', () => {
  describe('KNOWN_ASSETS', () => {
    it('should contain all required Rujira assets', () => {
      // Native L1 assets
      const requiredL1Assets = ['btc', 'eth', 'ltc', 'bch', 'doge', 'atom', 'avax', 'bnb', 'xrp', 'base_eth'];
      // THORChain native tokens  
      const requiredThorAssets = ['rune', 'tcy', 'ruji', 'auto', 'lqdy', 'nami'];
      // ERC20 tokens
      const requiredEthTokens = ['usdc_eth', 'usdt_eth', 'dai', 'gusd', 'usdp'];
      // Base tokens
      const requiredBaseTokens = ['usdc_base', 'cbbtc'];
      // BSC tokens
      const requiredBscTokens = ['usdc_bsc', 'usdt_bsc'];
      // Avalanche tokens
      const requiredAvaxTokens = ['usdc_avax', 'usdt_avax'];

      const allRequired = [
        ...requiredL1Assets, ...requiredThorAssets, ...requiredEthTokens,
        ...requiredBaseTokens, ...requiredBscTokens, ...requiredAvaxTokens
      ];
      
      for (const assetId of allRequired) {
        expect(KNOWN_ASSETS[assetId]).toBeDefined();
        expect(KNOWN_ASSETS[assetId].id).toBe(assetId);
      }

      // Should have all 27 assets
      expect(Object.keys(KNOWN_ASSETS).length).toBe(27);
    });

    it('should have correct decimal configurations', () => {
      // Bitcoin: native 8, thorchain 8, fin 6
      expect(KNOWN_ASSETS.btc.decimals).toEqual({
        native: 8,
        thorchain: 8,
        fin: 6
      });

      // USDC: native 6, thorchain 8, fin 6
      expect(KNOWN_ASSETS.usdc_eth.decimals).toEqual({
        native: 6,
        thorchain: 8,
        fin: 6
      });

      // ETH: native 18, thorchain 8, fin 6
      expect(KNOWN_ASSETS.eth.decimals).toEqual({
        native: 18,
        thorchain: 8,
        fin: 6
      });

      // ATOM: native 6, thorchain 8, fin 6
      expect(KNOWN_ASSETS.atom.decimals).toEqual({
        native: 6,
        thorchain: 8,
        fin: 6
      });
    });

    it('should have correct FIN format (THORChain identifiers)', () => {
      // Fixed FIN formats - should use THORChain chain identifiers
      expect(KNOWN_ASSETS.btc.formats.fin).toBe('btc-btc');
      expect(KNOWN_ASSETS.eth.formats.fin).toBe('eth-eth');
      expect(KNOWN_ASSETS.atom.formats.fin).toBe('gaia-atom'); // gaia not cosmos
      expect(KNOWN_ASSETS.bnb.formats.fin).toBe('bsc-bnb'); // bsc not binance
      
      // THORChain native tokens with special formats
      expect(KNOWN_ASSETS.rune.formats.fin).toBe('rune'); // no prefix
      expect(KNOWN_ASSETS.ruji.formats.fin).toBe('x/ruji'); // x/ prefix
      expect(KNOWN_ASSETS.auto.formats.fin).toBe('thor.auto'); // thor. prefix
      
      // Multi-chain tokens should have chain prefix
      expect(KNOWN_ASSETS.usdc_eth.formats.fin).toBe('eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
      expect(KNOWN_ASSETS.usdc_base.formats.fin).toBe('base-usdc-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
      expect(KNOWN_ASSETS.usdc_bsc.formats.fin).toBe('bsc-usdc-0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d');
    });

    it('should have correct contract addresses from Rujira specs', () => {
      // Ethereum tokens with correct addresses
      expect(KNOWN_ASSETS.usdc_eth.contract).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
      expect(KNOWN_ASSETS.usdt_eth.contract).toBe('0xdac17f958d2ee523a2206206994597c13d831ec7');
      expect(KNOWN_ASSETS.dai.contract).toBe('0x6b175474e89094c44da98b954eedeac495271d0f');
      
      // Base tokens
      expect(KNOWN_ASSETS.usdc_base.contract).toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
      expect(KNOWN_ASSETS.cbbtc.contract).toBe('0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf');
      
      // Native assets should not have contracts
      expect(KNOWN_ASSETS.btc.contract).toBeUndefined();
      expect(KNOWN_ASSETS.eth.contract).toBeUndefined();
      expect(KNOWN_ASSETS.rune.contract).toBeUndefined();
    });

    it('should have proper THORChain format configurations', () => {
      // Native L1 assets
      expect(KNOWN_ASSETS.btc.formats.thorchain).toBe('BTC.BTC');
      expect(KNOWN_ASSETS.eth.formats.thorchain).toBe('ETH.ETH');
      expect(KNOWN_ASSETS.atom.formats.thorchain).toBe('GAIA.ATOM'); // GAIA not COSMOS
      
      // ERC20 with contract addresses (uppercase)
      expect(KNOWN_ASSETS.usdc_eth.formats.thorchain).toBe('ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48');
      
      // THORChain native tokens
      expect(KNOWN_ASSETS.rune.formats.thorchain).toBe('THOR.RUNE');
      expect(KNOWN_ASSETS.ruji.formats.thorchain).toBe('THOR.RUJI');
    });
  });

  describe('getAsset', () => {
    it('should retrieve assets by ID', () => {
      const btc = getAsset('btc');
      expect(btc?.id).toBe('btc');
      expect(btc?.name).toBe('Bitcoin');

      const usdc = getAsset('usdc_eth');
      expect(usdc?.id).toBe('usdc_eth');
      expect(usdc?.name).toBe('USD Coin (Ethereum)');
      
      const ruji = getAsset('ruji');
      expect(ruji?.id).toBe('ruji');
      expect(ruji?.name).toBe('RUJI Token');
    });

    it('should be case insensitive', () => {
      expect(getAsset('BTC')?.id).toBe('btc');
      expect(getAsset('Btc')?.id).toBe('btc');
      expect(getAsset('USDC_ETH')?.id).toBe('usdc_eth');
    });

    it('should return null for unknown assets', () => {
      expect(getAsset('unknown')).toBeNull();
      expect(getAsset('')).toBeNull();
    });
  });

  describe('getAllAssets', () => {
    it('should return all 27 known assets', () => {
      const assets = getAllAssets();
      expect(assets.length).toBe(27);
      
      const assetIds = assets.map(a => a.id);
      expect(assetIds).toContain('btc');
      expect(assetIds).toContain('eth');
      expect(assetIds).toContain('usdc_eth');
      expect(assetIds).toContain('ruji');
      expect(assetIds).toContain('cbbtc');
    });
  });

  describe('getAssetsByChain', () => {
    it('should filter assets by chain', () => {
      const ethAssets = getAssetsByChain('ethereum');
      expect(ethAssets.length).toBe(6); // eth + 5 ERC20 tokens
      
      const thorAssets = getAssetsByChain('thorchain');
      expect(thorAssets.length).toBe(6); // rune + 5 thor tokens
      
      const baseAssets = getAssetsByChain('base');
      expect(baseAssets.length).toBe(3); // base_eth + usdc_base + cbbtc
    });
  });

  describe('getSupportedChains', () => {
    it('should return all supported chains', () => {
      const chains = getSupportedChains();
      expect(chains).toContain('bitcoin');
      expect(chains).toContain('ethereum');
      expect(chains).toContain('thorchain');
      expect(chains).toContain('base');
      expect(chains).toContain('binance');
      expect(chains).toContain('avalanche');
      expect(chains).toContain('cosmos');
      expect(chains).toContain('xrp');
      expect(chains.length).toBe(10);
    });
  });

  describe('getAssetStats', () => {
    it('should return correct statistics', () => {
      const stats = getAssetStats();
      expect(stats.totalAssets).toBe(27);
      expect(stats.supportedChains).toBe(10);
      expect(stats.nativeAssets).toBe(11); // L1 native assets + THORChain tokens
      expect(stats.tokenAssets).toBe(16); // ERC20 + other contract tokens
    });
  });

  describe('findAssetByFormat', () => {
    it('should find asset by L1 format', () => {
      expect(findAssetByFormat('BTC')?.id).toBe('btc');
      expect(findAssetByFormat('ETH')?.id).toBe('eth');
      expect(findAssetByFormat('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')?.id).toBe('usdc_eth');
    });

    it('should find asset by THORChain format', () => {
      expect(findAssetByFormat('BTC.BTC')?.id).toBe('btc');
      expect(findAssetByFormat('ETH.ETH')?.id).toBe('eth');
      expect(findAssetByFormat('ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48')?.id).toBe('usdc_eth');
      expect(findAssetByFormat('THOR.RUJI')?.id).toBe('ruji');
    });

    it('should find asset by FIN format (corrected)', () => {
      // Fixed FIN formats
      expect(findAssetByFormat('btc-btc')?.id).toBe('btc');
      expect(findAssetByFormat('eth-eth')?.id).toBe('eth');
      expect(findAssetByFormat('gaia-atom')?.id).toBe('atom');
      
      // Special FIN formats
      expect(findAssetByFormat('rune')?.id).toBe('rune');
      expect(findAssetByFormat('x/ruji')?.id).toBe('ruji');
      expect(findAssetByFormat('thor.auto')?.id).toBe('auto');
      
      // Multi-chain tokens
      expect(findAssetByFormat('eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')?.id).toBe('usdc_eth');
      expect(findAssetByFormat('base-usdc-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')?.id).toBe('usdc_base');
    });

    it('should find asset by ID', () => {
      expect(findAssetByFormat('btc')?.id).toBe('btc');
      expect(findAssetByFormat('usdc_eth')?.id).toBe('usdc_eth');
      expect(findAssetByFormat('ruji')?.id).toBe('ruji');
    });

    it('should be case insensitive', () => {
      expect(findAssetByFormat('btc.btc')?.id).toBe('btc');
      expect(findAssetByFormat('BTC-BTC')?.id).toBe('btc');
      expect(findAssetByFormat('X/RUJI')?.id).toBe('ruji');
      expect(findAssetByFormat('THOR.AUTO')?.id).toBe('auto');
    });

    it('should return null for unknown formats', () => {
      expect(findAssetByFormat('UNKNOWN')).toBeNull();
      expect(findAssetByFormat('fake.token')).toBeNull();
      expect(findAssetByFormat('invalid-format')).toBeNull();
      // Old wrong FIN formats should not work
      expect(findAssetByFormat('bitcoin-btc')).toBeNull();
      expect(findAssetByFormat('ethereum-eth')).toBeNull();
    });
  });

  describe('asset consistency', () => {
    it('should have consistent naming in formats', () => {
      for (const asset of Object.values(KNOWN_ASSETS)) {
        // THORChain format should be properly formatted
        expect(asset.formats.thorchain).toMatch(/^[A-Z]+\.[A-Z]+(-0X[A-F0-9]+)?$/);
        
        // FIN format should be lowercase (except special formats)
        if (!asset.formats.fin.startsWith('x/') && !asset.formats.fin.startsWith('thor.') && asset.formats.fin !== 'rune' && asset.formats.fin !== 'tcy') {
          expect(asset.formats.fin).toBe(asset.formats.fin.toLowerCase());
        }
      }
    });

    it('should have valid decimal configurations', () => {
      for (const asset of Object.values(KNOWN_ASSETS)) {
        // THORChain always uses 8 decimals
        expect(asset.decimals.thorchain).toBe(8);
        
        // FIN typically uses 6 decimals
        expect(asset.decimals.fin).toBe(6);
        
        // Native decimals should be reasonable
        expect(asset.decimals.native).toBeGreaterThan(0);
        expect(asset.decimals.native).toBeLessThanOrEqual(18);
      }
    });

    it('should have correct decimals for asset types', () => {
      // BTC-like assets: 8 decimals
      expect(KNOWN_ASSETS.btc.decimals.native).toBe(8);
      expect(KNOWN_ASSETS.ltc.decimals.native).toBe(8);
      expect(KNOWN_ASSETS.bch.decimals.native).toBe(8);
      expect(KNOWN_ASSETS.doge.decimals.native).toBe(8);
      
      // ETH-like assets: 18 decimals
      expect(KNOWN_ASSETS.eth.decimals.native).toBe(18);
      expect(KNOWN_ASSETS.avax.decimals.native).toBe(18);
      expect(KNOWN_ASSETS.base_eth.decimals.native).toBe(18);
      
      // Stablecoins: native decimals vary by token
      expect(KNOWN_ASSETS.usdc_eth.decimals.native).toBe(6);
      expect(KNOWN_ASSETS.usdt_eth.decimals.native).toBe(6);
      expect(KNOWN_ASSETS.dai.decimals.native).toBe(18);
      
      // Other specific assets
      expect(KNOWN_ASSETS.atom.decimals.native).toBe(6);
      expect(KNOWN_ASSETS.xrp.decimals.native).toBe(6);
      expect(KNOWN_ASSETS.bnb.decimals.native).toBe(8);
    });
  });
});