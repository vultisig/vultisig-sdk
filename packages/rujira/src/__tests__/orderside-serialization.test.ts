/**
 * OrderSide Serialization Tests
 *
 * Verifies the mapping between SDK OrderSide ('buy'/'sell') and
 * contract ContractSide ('base'/'quote').
 *
 * US-021: Audit item H1 verification
 */

import { describe, it, expect } from 'vitest';
import { toContractSide, fromContractSide, type OrderSide, type ContractSide } from '../types.js';

describe('OrderSide Serialization', () => {
  describe('toContractSide', () => {
    it('converts buy to quote', () => {
      expect(toContractSide('buy')).toBe('quote');
    });

    it('converts sell to base', () => {
      expect(toContractSide('sell')).toBe('base');
    });
  });

  describe('fromContractSide', () => {
    it('converts quote to buy', () => {
      expect(fromContractSide('quote')).toBe('buy');
    });

    it('converts base to sell', () => {
      expect(fromContractSide('base')).toBe('sell');
    });
  });

  describe('round-trip conversion', () => {
    it('preserves buy through round-trip', () => {
      const original: OrderSide = 'buy';
      const contract = toContractSide(original);
      const result = fromContractSide(contract);
      expect(result).toBe(original);
    });

    it('preserves sell through round-trip', () => {
      const original: OrderSide = 'sell';
      const contract = toContractSide(original);
      const result = fromContractSide(contract);
      expect(result).toBe(original);
    });

    it('preserves base through reverse round-trip', () => {
      const original: ContractSide = 'base';
      const sdk = fromContractSide(original);
      const result = toContractSide(sdk);
      expect(result).toBe(original);
    });

    it('preserves quote through reverse round-trip', () => {
      const original: ContractSide = 'quote';
      const sdk = fromContractSide(original);
      const result = toContractSide(sdk);
      expect(result).toBe(original);
    });
  });

  describe('semantic correctness', () => {
    /**
     * FIN contract semantics:
     * - base side = you're offering base asset = selling base
     * - quote side = you're offering quote asset = buying base
     */
    it('buy side offers quote asset to receive base asset', () => {
      // When you want to BUY base asset, you OFFER quote asset
      // This maps to the contract's "quote" side
      expect(toContractSide('buy')).toBe('quote');
    });

    it('sell side offers base asset to receive quote asset', () => {
      // When you want to SELL base asset, you OFFER base asset
      // This maps to the contract's "base" side
      expect(toContractSide('sell')).toBe('base');
    });
  });
});

/**
 * Live verification tests - run with LIVE_TESTS=1
 *
 * These tests query the actual FIN contract on THORChain mainnet
 * to verify the Side enum serialization format.
 */
describe.skipIf(!process.env.LIVE_TESTS)('Live OrderSide Verification', () => {
  const THORNODE_URL = 'https://thornode.ninerealms.com';

  it('verifies contract book response uses base/quote format', async () => {
    // Get list of FIN contracts
    const contractsRes = await fetch(
      `${THORNODE_URL}/cosmwasm/wasm/v1/code/73/contracts?pagination.limit=1`
    );
    const contracts = (await contractsRes.json()) as { contracts: string[] };
    const contractAddr = contracts.contracts[0];

    // Query book endpoint
    const bookQuery = btoa(JSON.stringify({ book: { limit: 3 } }));
    const bookRes = await fetch(
      `${THORNODE_URL}/cosmwasm/wasm/v1/contract/${contractAddr}/smart/${bookQuery}`
    );
    const bookData = (await bookRes.json()) as { data: { base: unknown[]; quote: unknown[] } };

    // Verify response structure uses base/quote (not buy/sell)
    expect(bookData.data).toHaveProperty('base');
    expect(bookData.data).toHaveProperty('quote');
    expect(Array.isArray(bookData.data.base)).toBe(true);
    expect(Array.isArray(bookData.data.quote)).toBe(true);
  });

  it('verifies contract config can be queried', async () => {
    const contractsRes = await fetch(
      `${THORNODE_URL}/cosmwasm/wasm/v1/code/73/contracts?pagination.limit=1`
    );
    const contracts = (await contractsRes.json()) as { contracts: string[] };
    const contractAddr = contracts.contracts[0];

    const configQuery = btoa(JSON.stringify({ config: {} }));
    const configRes = await fetch(
      `${THORNODE_URL}/cosmwasm/wasm/v1/contract/${contractAddr}/smart/${configQuery}`
    );
    const configData = (await configRes.json()) as { data: { denoms: string[] } };

    // Verify config has denoms array (the trading pair)
    expect(configData.data).toHaveProperty('denoms');
    expect(Array.isArray(configData.data.denoms)).toBe(true);
    expect(configData.data.denoms.length).toBe(2);
  });
});
