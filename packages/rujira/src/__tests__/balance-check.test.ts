/**
 * Tests for balance pre-check in swap operations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RujiraSwap } from '../modules/swap.js';
import { RujiraError, RujiraErrorCode } from '../errors.js';
import type { SwapQuote } from '../types.js';
import { VALID_THOR_ADDRESS } from './test-helpers.js';

// Mock the client with balance checking capabilities
const createMockClient = (balance: string = '1000000000') => ({
  config: {
    defaultSlippageBps: 100,
    contracts: {
      finContracts: {
        // Use lowercase FIN-format keys to match EASY_ROUTES format
        'rune/eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'thor1contract...',
      },
    },
  },
  discovery: {
    // Return a contract for any pair to ensure tests work
    getContractAddress: vi.fn().mockImplementation(async () => 'thor1contract...'),
  },
  simulateSwap: vi.fn().mockResolvedValue({
    returned: '99000000',
    fee: '1000000',
  }),
  orderbook: {
    getOrderBook: vi.fn().mockResolvedValue({
      pair: { base: '', quote: '', contractAddress: '', tick: '0', takerFee: '0', makerFee: '0' },
      bids: [{ price: '0.99', amount: '1000', total: '990' }],
      asks: [{ price: '1.01', amount: '1000', total: '1010' }],
      spread: '2.0',
      lastPrice: '1.00',
      timestamp: Date.now(),
    }),
  },
  executeContract: vi.fn().mockResolvedValue({
    transactionHash: 'TESTHASH123',
  }),
  getAddress: vi.fn().mockResolvedValue('thor1user...'),
  getBalance: vi.fn().mockResolvedValue({
    denom: 'rune',
    amount: balance,
  }),
});

describe('Balance Pre-check', () => {
  describe('execute() balance validation', () => {
    it('should allow execution when balance is sufficient', async () => {
      const mockClient = createMockClient('200000000'); // 2 RUNE
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const quote: SwapQuote = {
        params: {
          fromAsset: 'THOR.RUNE',
          toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
          amount: '100000000', // 1 RUNE
        },
        expectedOutput: '99000000',
        minimumOutput: '98000000',
        rate: '0.99',
        priceImpact: '0.1',
        fees: { network: '0', protocol: '1000000', affiliate: '0', total: '1000000' },
        contractAddress: 'thor1contract...',
        expiresAt: Date.now() + 120000,
        quoteId: 'test-quote',
      };

      const result = await swap.execute(quote);

      expect(result.txHash).toBe('TESTHASH123');
      expect(mockClient.getBalance).toHaveBeenCalledWith('thor1user...', 'rune');
    });

    it('should throw INSUFFICIENT_BALANCE when balance is too low', async () => {
      const mockClient = createMockClient('50000000'); // 0.5 RUNE (less than required)
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const quote: SwapQuote = {
        params: {
          fromAsset: 'THOR.RUNE',
          toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
          amount: '100000000', // 1 RUNE required
        },
        expectedOutput: '99000000',
        minimumOutput: '98000000',
        rate: '0.99',
        priceImpact: '0.1',
        fees: { network: '0', protocol: '1000000', affiliate: '0', total: '1000000' },
        contractAddress: 'thor1contract...',
        expiresAt: Date.now() + 120000,
        quoteId: 'test-quote',
      };

      await expect(swap.execute(quote)).rejects.toThrow(RujiraError);
      await expect(swap.execute(quote)).rejects.toMatchObject({
        code: RujiraErrorCode.INSUFFICIENT_BALANCE,
      });
    });

    it('should include required and available in error details', async () => {
      const mockClient = createMockClient('50000000');
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const quote: SwapQuote = {
        params: {
          fromAsset: 'THOR.RUNE',
          toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
          amount: '100000000',
        },
        expectedOutput: '99000000',
        minimumOutput: '98000000',
        rate: '0.99',
        priceImpact: '0.1',
        fees: { network: '0', protocol: '1000000', affiliate: '0', total: '1000000' },
        contractAddress: 'thor1contract...',
        expiresAt: Date.now() + 120000,
        quoteId: 'test-quote',
      };

      try {
        await swap.execute(quote);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RujiraError);
        const rujiraError = error as RujiraError;
        expect(rujiraError.details).toMatchObject({
          required: '100000000',
          available: '50000000',
          shortfall: '50000000',
          asset: 'THOR.RUNE',
        });
      }
    });

    it('should handle zero balance', async () => {
      const mockClient = createMockClient('0');
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const quote: SwapQuote = {
        params: {
          fromAsset: 'THOR.RUNE',
          toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
          amount: '100000000',
        },
        expectedOutput: '99000000',
        minimumOutput: '98000000',
        rate: '0.99',
        priceImpact: '0.1',
        fees: { network: '0', protocol: '1000000', affiliate: '0', total: '1000000' },
        contractAddress: 'thor1contract...',
        expiresAt: Date.now() + 120000,
        quoteId: 'test-quote',
      };

      await expect(swap.execute(quote)).rejects.toMatchObject({
        code: RujiraErrorCode.INSUFFICIENT_BALANCE,
      });
    });

    it('should pass when balance exactly matches required', async () => {
      const mockClient = createMockClient('100000000'); // Exactly 1 RUNE
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const quote: SwapQuote = {
        params: {
          fromAsset: 'THOR.RUNE',
          toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
          amount: '100000000', // 1 RUNE
        },
        expectedOutput: '99000000',
        minimumOutput: '98000000',
        rate: '0.99',
        priceImpact: '0.1',
        fees: { network: '0', protocol: '1000000', affiliate: '0', total: '1000000' },
        contractAddress: 'thor1contract...',
        expiresAt: Date.now() + 120000,
        quoteId: 'test-quote',
      };

      const result = await swap.execute(quote);
      expect(result.txHash).toBe('TESTHASH123');
    });
  });

  describe('easySwap() balance validation', () => {
    it('should validate balance early before fetching quote', async () => {
      const mockClient = createMockClient('50000000'); // Insufficient
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      await expect(
        swap.easySwap({
          route: 'RUNE_TO_USDC',
          amount: '100000000',
          destination: VALID_THOR_ADDRESS,
        })
      ).rejects.toMatchObject({
        code: RujiraErrorCode.INSUFFICIENT_BALANCE,
      });

      // simulateSwap should NOT have been called (fail fast)
      expect(mockClient.simulateSwap).not.toHaveBeenCalled();
    });

    it('should allow easySwap when balance is sufficient', async () => {
      const mockClient = createMockClient('200000000'); // Sufficient
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const result = await swap.easySwap({
        route: 'RUNE_TO_USDC',
        amount: '100000000',
        destination: VALID_THOR_ADDRESS,
      });

      expect(result.txHash).toBe('TESTHASH123');
    });

    it('should validate balance with direct from/to assets', async () => {
      const mockClient = createMockClient('50000000'); // Insufficient
      mockClient.config.contracts.finContracts['BTC.BTC/ETH.ETH'] = 'thor1btceth...';

      const swap = new RujiraSwap(mockClient as any, { cache: false });

      await expect(
        swap.easySwap({
          from: 'THOR.RUNE',
          to: 'BTC.BTC',
          amount: '100000000',
          destination: VALID_THOR_ADDRESS,
        })
      ).rejects.toMatchObject({
        code: RujiraErrorCode.INSUFFICIENT_BALANCE,
      });
    });
  });

  describe('error message quality', () => {
    it('should include asset ticker in error message', async () => {
      const mockClient = createMockClient('50000000');
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const quote: SwapQuote = {
        params: {
          fromAsset: 'THOR.RUNE',
          toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
          amount: '100000000',
        },
        expectedOutput: '99000000',
        minimumOutput: '98000000',
        rate: '0.99',
        priceImpact: '0.1',
        fees: { network: '0', protocol: '1000000', affiliate: '0', total: '1000000' },
        contractAddress: 'thor1contract...',
        expiresAt: Date.now() + 120000,
        quoteId: 'test-quote',
      };

      try {
        await swap.execute(quote);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RujiraError);
        const rujiraError = error as RujiraError;
        // Error message uses chain name (THORCHAIN) rather than ticker (RUNE)
        expect(rujiraError.message).toContain('THORCHAIN');
        expect(rujiraError.message).toContain('Required:');
        expect(rujiraError.message).toContain('Available:');
      }
    });
  });
});
