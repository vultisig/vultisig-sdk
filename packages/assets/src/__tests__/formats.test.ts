import { describe, it, expect } from 'vitest';
import { 
  toThorchainFormat,
  toFinFormat,
  toL1Format,
  parseAsset,
  detectFormat,
  convertFormat,
  extractChainFromThorchain,
  extractSymbolFromThorchain,
  extractContractFromThorchain,
  buildThorchainFormat,
  buildFinFormat
} from '../formats.js';
import { getAsset } from '../registry.js';

describe('Format Converters', () => {
  const btc = getAsset('btc')!;
  const usdc = getAsset('usdc')!;
  const eth = getAsset('eth')!;

  describe('format conversion', () => {
    it('should convert to THORChain format', () => {
      expect(toThorchainFormat(btc)).toBe('BTC.BTC');
      expect(toThorchainFormat(usdc)).toBe('ETH.USDC-0XA0B86A33E6441E8C673896CF5F37C0DAC6F2E38D');
      expect(toThorchainFormat(eth)).toBe('ETH.ETH');
    });

    it('should convert to FIN format', () => {
      expect(toFinFormat(btc)).toBe('bitcoin-btc');
      expect(toFinFormat(usdc)).toBe('ethereum-usdc');
      expect(toFinFormat(eth)).toBe('ethereum-eth');
    });

    it('should convert to L1 format', () => {
      expect(toL1Format(btc)).toBe('BTC');
      expect(toL1Format(usdc)).toBe('0xA0b86a33E6441e8c673896Cf5F37c0DAc6F2e38d');
      expect(toL1Format(eth)).toBe('ETH');
    });
  });

  describe('asset parsing', () => {
    it('should parse BTC from various formats', () => {
      expect(parseAsset('BTC')?.id).toBe('btc');
      expect(parseAsset('btc.btc')?.id).toBe('btc');
      expect(parseAsset('bitcoin-btc')?.id).toBe('btc');
    });

    it('should parse USDC from various formats', () => {
      expect(parseAsset('0xA0b86a33E6441e8c673896Cf5F37c0DAc6F2e38d')?.id).toBe('usdc');
      expect(parseAsset('ETH.USDC-0XA0B86A33E6441E8C673896CF5F37C0DAC6F2E38D')?.id).toBe('usdc');
      expect(parseAsset('ethereum-usdc')?.id).toBe('usdc');
    });

    it('should return null for unknown assets', () => {
      expect(parseAsset('UNKNOWN')).toBeNull();
      expect(parseAsset('fake-token')).toBeNull();
    });
  });

  describe('format detection', () => {
    it('should detect THORChain format', () => {
      expect(detectFormat('BTC.BTC')).toBe('thorchain');
      expect(detectFormat('ETH.USDC-0XA0B86A33E6441E8C673896CF5F37C0DAC6F2E38D')).toBe('thorchain');
    });

    it('should detect FIN format', () => {
      expect(detectFormat('bitcoin-btc')).toBe('fin');
      expect(detectFormat('ethereum-usdc')).toBe('fin');
    });

    it('should detect L1 format', () => {
      expect(detectFormat('BTC')).toBe('l1');
      expect(detectFormat('0xA0b86a33E6441e8c673896Cf5F37c0DAc6F2e38d')).toBe('l1');
    });

    it('should detect unknown format', () => {
      expect(detectFormat('invalid-format-123-456')).toBe('unknown');
      expect(detectFormat('')).toBe('unknown');
    });
  });

  describe('format conversion', () => {
    it('should convert between formats', () => {
      expect(convertFormat('BTC', 'thorchain')).toBe('BTC.BTC');
      expect(convertFormat('BTC.BTC', 'fin')).toBe('bitcoin-btc');
      expect(convertFormat('bitcoin-btc', 'l1')).toBe('BTC');
    });

    it('should return null for unknown assets', () => {
      expect(convertFormat('UNKNOWN', 'thorchain')).toBeNull();
    });
  });

  describe('THORChain parsing', () => {
    it('should extract chain from THORChain format', () => {
      expect(extractChainFromThorchain('BTC.BTC')).toBe('bitcoin');
      expect(extractChainFromThorchain('ETH.USDC-0XA0B86A33E6441E8C673896CF5F37C0DAC6F2E38D')).toBe('ethereum');
      expect(extractChainFromThorchain('THOR.RUNE')).toBe('thorchain');
    });

    it('should extract symbol from THORChain format', () => {
      expect(extractSymbolFromThorchain('BTC.BTC')).toBe('BTC');
      expect(extractSymbolFromThorchain('ETH.USDC-0XA0B86A33E6441E8C673896CF5F37C0DAC6F2E38D')).toBe('USDC');
    });

    it('should extract contract from THORChain format', () => {
      expect(extractContractFromThorchain('BTC.BTC')).toBeUndefined();
      expect(extractContractFromThorchain('ETH.USDC-0XA0B86A33E6441E8C673896CF5F37C0DAC6F2E38D'))
        .toBe('0XA0B86A33E6441E8C673896CF5F37C0DAC6F2E38D');
    });
  });

  describe('format building', () => {
    it('should build THORChain format', () => {
      expect(buildThorchainFormat('btc', 'btc')).toBe('BTC.BTC');
      expect(buildThorchainFormat('eth', 'usdc', '0xA0b86a33E6441e8c673896Cf5F37c0DAc6F2e38d'))
        .toBe('ETH.USDC-0XA0B86A33E6441E8C673896CF5F37C0DAC6F2E38D');
    });

    it('should build FIN format', () => {
      expect(buildFinFormat('bitcoin', 'btc')).toBe('bitcoin-btc');
      expect(buildFinFormat('ethereum', 'usdc', '0xA0b86a33E6441e8c673896Cf5F37c0DAc6F2e38d'))
        .toBe('ethereum-usdc-0xa0b86a33e6441e8c673896cf5f37c0dac6f2e38d');
    });
  });
});