import { describe, it, expect } from 'vitest';
import { denomToTicker, denomToAsset, extractSymbol } from '../utils/denom-conversion.js';

describe('denomToTicker', () => {
  it('resolves known assets via registry', () => {
    // Uses asset.id - reliable ticker derivation
    expect(denomToTicker('rune')).toBe('RUNE');
    expect(denomToTicker('BTC.BTC')).toBe('BTC');
    expect(denomToTicker('ETH.ETH')).toBe('ETH');
    expect(denomToTicker('GAIA.ATOM')).toBe('ATOM');
  });

  it('parses denom format as fallback', () => {
    expect(denomToTicker('unknown-token')).toBe('TOKEN');
  });

  it('handles simple denoms', () => {
    expect(denomToTicker('xyz')).toBe('XYZ');
  });
});

describe('denomToAsset', () => {
  it('resolves known assets to thorchain format', () => {
    expect(denomToAsset('rune')).toBe('THOR.RUNE');
    expect(denomToAsset('BTC.BTC')).toBe('BTC.BTC');
  });

  it('reverse-engineers denom format', () => {
    expect(denomToAsset('btc-btc')).toBe('BTC.BTC');
    expect(denomToAsset('eth-eth')).toBe('ETH.ETH');
  });

  it('returns null for unresolvable single-word denoms', () => {
    expect(denomToAsset('unknowntoken')).toBeNull();
  });

  it('handles multi-part denoms with contract addresses', () => {
    const result = denomToAsset('eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
    // Should resolve via registry or parse
    expect(result).toBeTruthy();
  });
});

describe('extractSymbol', () => {
  it('extracts from thorchain asset format', () => {
    expect(extractSymbol('ETH.USDC-0XA0B86991')).toBe('USDC');
    expect(extractSymbol('BTC.BTC')).toBe('BTC');
    expect(extractSymbol('THOR.RUNE')).toBe('RUNE');
  });

  it('extracts from denom format', () => {
    expect(extractSymbol('eth-usdc-0xa0b86991')).toBe('USDC');
    expect(extractSymbol('btc-btc')).toBe('BTC');
  });

  it('handles simple strings', () => {
    expect(extractSymbol('rune')).toBe('RUNE');
  });
});
