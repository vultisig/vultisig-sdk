import { describe, it, expect } from 'vitest';
import { 
  KNOWN_ASSETS,
  getAsset,
  getAllAssets,
  findAssetByFormat
} from '../registry.js';

describe('Asset Registry', () => {
  describe('KNOWN_ASSETS', () => {
    it('should contain all required assets', () => {
      const requiredAssets = ['btc', 'eth', 'rune', 'usdc', 'usdt', 'avax', 'atom', 'doge', 'ltc', 'bch', 'bnb'];
      
      for (const assetId of requiredAssets) {
        expect(KNOWN_ASSETS[assetId]).toBeDefined();
        expect(KNOWN_ASSETS[assetId].id).toBe(assetId);
      }
    });

    it('should have correct decimal configurations', () => {
      // Bitcoin: native 8, thorchain 8, fin 6
      expect(KNOWN_ASSETS.btc.decimals).toEqual({
        native: 8,
        thorchain: 8,
        fin: 6
      });

      // USDC: native 6, thorchain 8, fin 6
      expect(KNOWN_ASSETS.usdc.decimals).toEqual({
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
    });

    it('should have correct format configurations', () => {
      // Bitcoin formats
      expect(KNOWN_ASSETS.btc.formats).toEqual({
        l1: 'BTC',
        thorchain: 'BTC.BTC',
        fin: 'bitcoin-btc'
      });

      // USDC formats (with contract)
      expect(KNOWN_ASSETS.usdc.formats.l1).toBe('0xA0b86a33E6441e8c673896Cf5F37c0DAc6F2e38d');
      expect(KNOWN_ASSETS.usdc.formats.thorchain).toBe('ETH.USDC-0XA0B86A33E6441E8C673896CF5F37C0DAC6F2E38D');
      expect(KNOWN_ASSETS.usdc.formats.fin).toBe('ethereum-usdc');
    });

    it('should have contract addresses for ERC20 tokens', () => {
      expect(KNOWN_ASSETS.usdc.contract).toBeTruthy();
      expect(KNOWN_ASSETS.usdt.contract).toBeTruthy();
      expect(KNOWN_ASSETS.btc.contract).toBeUndefined();
      expect(KNOWN_ASSETS.eth.contract).toBeUndefined();
    });
  });

  describe('getAsset', () => {
    it('should retrieve assets by ID', () => {
      const btc = getAsset('btc');
      expect(btc?.id).toBe('btc');
      expect(btc?.name).toBe('Bitcoin');

      const usdc = getAsset('usdc');
      expect(usdc?.id).toBe('usdc');
      expect(usdc?.name).toBe('USD Coin');
    });

    it('should be case insensitive', () => {
      expect(getAsset('BTC')?.id).toBe('btc');
      expect(getAsset('Btc')?.id).toBe('btc');
      expect(getAsset('USDC')?.id).toBe('usdc');
    });

    it('should return null for unknown assets', () => {
      expect(getAsset('unknown')).toBeNull();
      expect(getAsset('')).toBeNull();
    });
  });

  describe('getAllAssets', () => {
    it('should return all known assets', () => {
      const assets = getAllAssets();
      expect(assets.length).toBeGreaterThanOrEqual(11); // At least the required ones
      
      const assetIds = assets.map(a => a.id);
      expect(assetIds).toContain('btc');
      expect(assetIds).toContain('eth');
      expect(assetIds).toContain('usdc');
    });
  });

  describe('findAssetByFormat', () => {
    it('should find asset by L1 format', () => {
      expect(findAssetByFormat('BTC')?.id).toBe('btc');
      expect(findAssetByFormat('ETH')?.id).toBe('eth');
      expect(findAssetByFormat('0xA0b86a33E6441e8c673896Cf5F37c0DAc6F2e38d')?.id).toBe('usdc');
    });

    it('should find asset by THORChain format', () => {
      expect(findAssetByFormat('BTC.BTC')?.id).toBe('btc');
      expect(findAssetByFormat('ETH.ETH')?.id).toBe('eth');
      expect(findAssetByFormat('ETH.USDC-0XA0B86A33E6441E8C673896CF5F37C0DAC6F2E38D')?.id).toBe('usdc');
    });

    it('should find asset by FIN format', () => {
      expect(findAssetByFormat('bitcoin-btc')?.id).toBe('btc');
      expect(findAssetByFormat('ethereum-eth')?.id).toBe('eth');
      expect(findAssetByFormat('ethereum-usdc')?.id).toBe('usdc');
    });

    it('should find asset by ID', () => {
      expect(findAssetByFormat('btc')?.id).toBe('btc');
      expect(findAssetByFormat('usdc')?.id).toBe('usdc');
    });

    it('should be case insensitive', () => {
      expect(findAssetByFormat('btc.btc')?.id).toBe('btc');
      expect(findAssetByFormat('BITCOIN-BTC')?.id).toBe('btc');
      expect(findAssetByFormat('ethereum-USDC')?.id).toBe('usdc');
    });

    it('should return null for unknown formats', () => {
      expect(findAssetByFormat('UNKNOWN')).toBeNull();
      expect(findAssetByFormat('fake.token')).toBeNull();
      expect(findAssetByFormat('invalid-format')).toBeNull();
    });
  });

  describe('asset consistency', () => {
    it('should have consistent naming in formats', () => {
      for (const asset of Object.values(KNOWN_ASSETS)) {
        // THORChain format should contain the asset symbol in uppercase
        expect(asset.formats.thorchain).toContain(asset.id.toUpperCase());
        
        // FIN format should contain the asset ID in lowercase
        expect(asset.formats.fin).toContain(asset.id.toLowerCase());
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
  });
});