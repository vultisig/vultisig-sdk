/**
 * Tests for destination address validation (MEDIUM-2 security fix)
 */

import { describe, it, expect, vi } from 'vitest';
import { RujiraSwap } from '../modules/swap.js';
import { RujiraError, RujiraErrorCode } from '../errors.js';
import { VALID_THOR_ADDRESS } from './test-helpers.js';

// Mock client for testing
const createMockClient = () => ({
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
    amount: '1000000000',
  }),
  // Mock persistence method (no-op for tests)
  persistFinContracts: vi.fn().mockResolvedValue(undefined),
});

describe('Address Validation', () => {
  describe('valid addresses', () => {
    it('should accept valid thor1 mainnet address', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      const result = await swap.easySwap({
        route: 'RUNE_TO_USDC',
        amount: '100000000',
        destination: VALID_THOR_ADDRESS,
      });

      expect(result.txHash).toBe('TESTHASH123');
    });

    // mainnet-only: non-mainnet address tests removed

  });

  describe('invalid address prefix', () => {
    it("should reject address without 'thor1' prefix", async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      await expect(
        swap.easySwap({
          route: 'RUNE_TO_USDC',
          amount: '100000000',
          destination: 'cosmos1qperwt9wrnkg5k9e5gzfgjppxgnwqdwqgglcvrl',
        })
      ).rejects.toMatchObject({
        code: RujiraErrorCode.INVALID_ADDRESS,
      });
    });

    it('should reject Ethereum address', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      await expect(
        swap.easySwap({
          route: 'RUNE_TO_USDC',
          amount: '100000000',
          destination: '0x1234567890123456789012345678901234567890',
        })
      ).rejects.toMatchObject({
        code: RujiraErrorCode.INVALID_ADDRESS,
      });
    });

    it('should reject Bitcoin address', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      await expect(
        swap.easySwap({
          route: 'RUNE_TO_USDC',
          amount: '100000000',
          destination: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
        })
      ).rejects.toMatchObject({
        code: RujiraErrorCode.INVALID_ADDRESS,
      });
    });
  });

  describe('invalid bech32 checksum', () => {
    it('should reject address with invalid checksum', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      // This address has valid format but wrong checksum
      await expect(
        swap.easySwap({
          route: 'RUNE_TO_USDC',
          amount: '100000000',
          destination: 'thor1qperwt9wrnkg5k9e5gzfgjppxgnwqdwqgglcvrl', // invalid checksum
        })
      ).rejects.toMatchObject({
        code: RujiraErrorCode.INVALID_ADDRESS,
      });
    });

    // mainnet-only: non-mainnet address checksum test removed

  });

  describe('invalid address length', () => {
    it('should reject address that is too short', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      await expect(
        swap.easySwap({
          route: 'RUNE_TO_USDC',
          amount: '100000000',
          destination: 'thor1short',
        })
      ).rejects.toMatchObject({
        code: RujiraErrorCode.INVALID_ADDRESS,
      });
    });

    it('should reject address that is too long', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      await expect(
        swap.easySwap({
          route: 'RUNE_TO_USDC',
          amount: '100000000',
          destination: 'thor1qperwt9wrnkg5k9e5gzfgjppxgnwqdwqgglcvrlextracharacters',
        })
      ).rejects.toMatchObject({
        code: RujiraErrorCode.INVALID_ADDRESS,
      });
    });
  });

  describe('invalid bech32 characters', () => {
    it('should reject address with uppercase letters', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      await expect(
        swap.easySwap({
          route: 'RUNE_TO_USDC',
          amount: '100000000',
          destination: 'thor1QPERWT9WRNKG5K9E5GZFGJPPXGNWQDWQGGLCVRL',
        })
      ).rejects.toMatchObject({
        code: RujiraErrorCode.INVALID_ADDRESS,
      });
    });

    it('should reject address with invalid bech32 character "b"', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      await expect(
        swap.easySwap({
          route: 'RUNE_TO_USDC',
          amount: '100000000',
          destination: 'thor1qperwt9wrnkb5k9e5gzfgjppxgnwqdwqgglcvrl',
        })
      ).rejects.toMatchObject({
        code: RujiraErrorCode.INVALID_ADDRESS,
      });
    });

    it('should reject address with invalid bech32 character "i"', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      await expect(
        swap.easySwap({
          route: 'RUNE_TO_USDC',
          amount: '100000000',
          destination: 'thor1qperwt9wrnki5k9e5gzfgjppxgnwqdwqgglcvrl',
        })
      ).rejects.toMatchObject({
        code: RujiraErrorCode.INVALID_ADDRESS,
      });
    });

    it('should reject address with invalid bech32 character "o"', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      await expect(
        swap.easySwap({
          route: 'RUNE_TO_USDC',
          amount: '100000000',
          destination: 'thor1qperwt9wrnko5k9e5gzfgjppxgnwqdwqgglcvrl',
        })
      ).rejects.toMatchObject({
        code: RujiraErrorCode.INVALID_ADDRESS,
      });
    });
  });

  describe('empty/missing address', () => {
    it('should reject empty string', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      await expect(
        swap.easySwap({
          route: 'RUNE_TO_USDC',
          amount: '100000000',
          destination: '',
        })
      ).rejects.toMatchObject({
        code: RujiraErrorCode.INVALID_ADDRESS,
      });
    });

    it('should reject whitespace-only string', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      await expect(
        swap.easySwap({
          route: 'RUNE_TO_USDC',
          amount: '100000000',
          destination: '   ',
        })
      ).rejects.toMatchObject({
        code: RujiraErrorCode.INVALID_ADDRESS,
      });
    });
  });

  describe('getQuote with destination', () => {
    it('should validate destination in getQuote when provided', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      await expect(
        swap.getQuote({
          fromAsset: 'THOR.RUNE',
          toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
          amount: '100000000',
          destination: 'invalid_address',
        })
      ).rejects.toMatchObject({
        code: RujiraErrorCode.INVALID_ADDRESS,
      });
    });

    it('should allow getQuote without destination', async () => {
      const mockClient = createMockClient();
      const swap = new RujiraSwap(mockClient as any, { cache: false });

      // Should not throw when destination is not provided
      const quote = await swap.getQuote({
        fromAsset: 'THOR.RUNE',
        toAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        amount: '100000000',
      });

      expect(quote).toBeDefined();
      expect(quote.expectedOutput).toBe('99000000');
    });
  });
});
