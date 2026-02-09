/**
 * Tests for the Deposit module
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RujiraClient } from '../client.js';
import { RujiraDeposit } from '../modules/deposit.js';
import { RujiraError, RujiraErrorCode } from '../errors.js';
import { VALID_THOR_ADDRESS } from './test-helpers.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('RujiraDeposit', () => {
  let client: RujiraClient;
  let deposit: RujiraDeposit;

  beforeEach(() => {
    client = new RujiraClient();
    deposit = client.deposit;
    mockFetch.mockReset();
  });

  describe('buildDepositMemo', () => {
    it('should build basic deposit memo with secure+ format', () => {
      const memo = deposit.buildDepositMemo('BTC.BTC', VALID_THOR_ADDRESS);
      expect(memo).toBe(`secure+:${VALID_THOR_ADDRESS}`);
    });

    it('should build deposit memo with affiliate', () => {
      const memo = deposit.buildDepositMemo(
        'ETH.ETH',
        VALID_THOR_ADDRESS,
        'thor1affiliate',
        50
      );
      expect(memo).toBe(`secure+:${VALID_THOR_ADDRESS}:thor1affiliate:50`);
    });

    it('should use secure+ format regardless of asset case', () => {
      const memo = deposit.buildDepositMemo('btc.btc', VALID_THOR_ADDRESS);
      expect(memo).toBe(`secure+:${VALID_THOR_ADDRESS}`);
    });

    it('should not include affiliate if bps is 0', () => {
      const memo = deposit.buildDepositMemo(
        'BTC.BTC',
        VALID_THOR_ADDRESS,
        'thor1affiliate',
        0
      );
      expect(memo).toBe(`secure+:${VALID_THOR_ADDRESS}`);
    });

    it('should reject addresses with colon (injection prevention)', () => {
      expect(() =>
        deposit.buildDepositMemo('BTC.BTC', 'thor1abc:evil')
      ).toThrow("contains ':'");
    });

    it('should reject affiliate with colon (injection prevention)', () => {
      expect(() =>
        deposit.buildDepositMemo('BTC.BTC', VALID_THOR_ADDRESS, 'aff:evil', 50)
      ).toThrow("contains ':'");
    });
  });

  describe('estimateDepositTime', () => {
    it('should return correct time for BTC', () => {
      expect(deposit.estimateDepositTime('BTC')).toBe(30);
    });

    it('should return correct time for ETH', () => {
      expect(deposit.estimateDepositTime('ETH')).toBe(5);
    });

    it('should return correct time for AVAX', () => {
      expect(deposit.estimateDepositTime('AVAX')).toBe(1);
    });

    it('should be case insensitive', () => {
      expect(deposit.estimateDepositTime('btc')).toBe(30);
      expect(deposit.estimateDepositTime('Eth')).toBe(5);
    });

    it('should return default for unknown chains', () => {
      expect(deposit.estimateDepositTime('UNKNOWN')).toBe(15);
    });
  });

  describe('getSupportedChains', () => {
    it('should return all supported chains', () => {
      const chains = deposit.getSupportedChains();
      expect(chains).toContain('BTC');
      expect(chains).toContain('ETH');
      expect(chains).toContain('BSC');
      expect(chains).toContain('AVAX');
      expect(chains).toContain('GAIA');
    });
  });

  describe('isChainSupported', () => {
    it('should return true for supported chains', () => {
      expect(deposit.isChainSupported('BTC')).toBe(true);
      expect(deposit.isChainSupported('ETH')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(deposit.isChainSupported('btc')).toBe(true);
      expect(deposit.isChainSupported('Eth')).toBe(true);
    });

    it('should return false for unsupported chains', () => {
      expect(deposit.isChainSupported('SOLANA')).toBe(false);
    });
  });

  describe('canDeposit', () => {
    it('should return true for supported assets', () => {
      expect(deposit.canDeposit('BTC.BTC')).toBe(true);
      expect(deposit.canDeposit('ETH.ETH')).toBe(true);
      expect(deposit.canDeposit('ETH.USDC-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(true);
    });

    it('should return false for unsupported assets', () => {
      expect(deposit.canDeposit('SOLANA.SOL')).toBe(false);
    });
  });

  describe('prepare', () => {
    beforeEach(() => {
      // Mock successful inbound addresses response
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          {
            chain: 'BTC',
            address: 'bc1qinbound...',
            pub_key: 'thorpub...',
            halted: false,
            global_trading_paused: false,
            chain_trading_paused: false,
            chain_lp_actions_paused: false,
            gas_rate: '10',
            gas_rate_units: 'satsperbyte',
            outbound_tx_size: '1000',
            outbound_fee: '30000',
            dust_threshold: '10000',
          },
          {
            chain: 'ETH',
            address: '0xinbound...',
            pub_key: 'thorpub...',
            halted: false,
            global_trading_paused: false,
            chain_trading_paused: false,
            chain_lp_actions_paused: false,
            gas_rate: '30',
            gas_rate_units: 'gwei',
            outbound_tx_size: '21000',
            outbound_fee: '2400000000000000',
            dust_threshold: '0',
          },
        ]),
      });
    });

    it('should prepare BTC deposit', async () => {
      const result = await deposit.prepare({
        fromAsset: 'BTC.BTC',
        amount: '1000000',
        thorAddress: VALID_THOR_ADDRESS,
      });

      expect(result.chain).toBe('BTC');
      expect(result.inboundAddress).toBe('bc1qinbound...');
      expect(result.memo).toBe(`secure+:${VALID_THOR_ADDRESS}`);
      expect(result.amount).toBe('1000000');
      expect(result.asset).toBe('BTC.BTC');
      expect(result.resultingDenom).toBe('btc-btc');
      expect(result.estimatedTimeMinutes).toBe(30);
      expect(result.minimumAmount).toBe('10000');
      expect(result.gasRate).toBe('10');
    });

    it('should prepare ETH deposit', async () => {
      const result = await deposit.prepare({
        fromAsset: 'ETH.ETH',
        amount: '1000000000000000000',
        thorAddress: VALID_THOR_ADDRESS,
      });

      expect(result.chain).toBe('ETH');
      expect(result.inboundAddress).toBe('0xinbound...');
      expect(result.resultingDenom).toBe('eth-eth');
      expect(result.estimatedTimeMinutes).toBe(5);
    });

    it('should include affiliate info in memo', async () => {
      const result = await deposit.prepare({
        fromAsset: 'BTC.BTC',
        amount: '1000000',
        thorAddress: VALID_THOR_ADDRESS,
        affiliate: 'thor1affiliate',
        affiliateBps: 50,
      });

      expect(result.memo).toBe(`secure+:${VALID_THOR_ADDRESS}:thor1affiliate:50`);
    });

    it('should include warning for halted chain', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          {
            chain: 'BTC',
            address: 'bc1qinbound...',
            halted: true,
            global_trading_paused: false,
            chain_trading_paused: false,
            chain_lp_actions_paused: false,
            gas_rate: '10',
            gas_rate_units: 'satsperbyte',
            outbound_tx_size: '1000',
            outbound_fee: '30000',
            dust_threshold: '10000',
          },
        ]),
      });

      const result = await deposit.prepare({
        fromAsset: 'BTC.BTC',
        amount: '1000000',
        thorAddress: VALID_THOR_ADDRESS,
      });

      expect(result.warning).toContain('halted');
    });

    it('should reject invalid asset format', async () => {
      await expect(
        deposit.prepare({
          fromAsset: 'BTCBTC', // Missing dot
          amount: '1000000',
          thorAddress: VALID_THOR_ADDRESS,
        })
      ).rejects.toThrow(RujiraError);
    });

    it('should reject unsupported chain', async () => {
      await expect(
        deposit.prepare({
          fromAsset: 'SOLANA.SOL',
          amount: '1000000',
          thorAddress: VALID_THOR_ADDRESS,
        })
      ).rejects.toThrow(RujiraError);
    });

    it('should reject invalid amount', async () => {
      await expect(
        deposit.prepare({
          fromAsset: 'BTC.BTC',
          amount: '-100',
          thorAddress: VALID_THOR_ADDRESS,
        })
      ).rejects.toThrow(RujiraError);

      await expect(
        deposit.prepare({
          fromAsset: 'BTC.BTC',
          amount: 'abc',
          thorAddress: VALID_THOR_ADDRESS,
        })
      ).rejects.toThrow(RujiraError);
    });

    it('should reject invalid thor address', async () => {
      await expect(
        deposit.prepare({
          fromAsset: 'BTC.BTC',
          amount: '1000000',
          thorAddress: 'invalid',
        })
      ).rejects.toThrow(RujiraError);

      await expect(
        deposit.prepare({
          fromAsset: 'BTC.BTC',
          amount: '1000000',
          thorAddress: '0x1234567890123456789012345678901234567890', // Ethereum address
        })
      ).rejects.toThrow(RujiraError);
    });

    // mainnet-only: non-mainnet address tests removed

  });

  describe('getBalances', () => {
    it('should fetch and parse balances', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          balances: [
            { denom: 'rune', amount: '1000000000' },
            { denom: 'btc-btc', amount: '100000000' },
            { denom: 'eth-eth', amount: '5000000000000000000' },
          ],
        }),
      });

      const balances = await deposit.getBalances(VALID_THOR_ADDRESS);

      expect(balances).toHaveLength(3);
      expect(balances[0]?.denom).toBe('rune');
      // Asset field contains the identifier from the response
      expect(balances[0]?.asset).toBe('THOR.RUNE');
      expect(balances[1]?.denom).toBe('btc-btc');
      expect(balances[1]?.asset).toBe('BTC.BTC');
    });

    it('should reject invalid thor address', async () => {
      await expect(deposit.getBalances('invalid')).rejects.toThrow(RujiraError);
    });

    it('should handle empty balances', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ balances: [] }),
      });

      const balances = await deposit.getBalances(VALID_THOR_ADDRESS);
      expect(balances).toEqual([]);
    });
  });

  describe('getBalance', () => {
    it('should fetch balance for specific asset', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          balances: [
            { denom: 'btc-btc', amount: '100000000' },
          ],
        }),
      });

      const balance = await deposit.getBalance(VALID_THOR_ADDRESS, 'BTC.BTC');

      expect(balance).not.toBeNull();
      expect(balance?.denom).toBe('btc-btc');
      expect(balance?.amount).toBe('100000000');
    });

    it('should return null for missing asset', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          balances: [
            { denom: 'btc-btc', amount: '100000000' },
          ],
        }),
      });

      const balance = await deposit.getBalance(VALID_THOR_ADDRESS, 'ETH.ETH');
      expect(balance).toBeNull();
    });
  });

  describe('getInboundAddress', () => {
    it('should fetch inbound address for chain', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { chain: 'BTC', address: 'bc1q...', halted: false },
          { chain: 'ETH', address: '0x...', halted: false },
        ]),
      });

      const btc = await deposit.getInboundAddress('BTC');
      expect(btc?.chain).toBe('BTC');
      expect(btc?.address).toBe('bc1q...');
    });

    it('should be case insensitive', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { chain: 'BTC', address: 'bc1q...', halted: false },
        ]),
      });

      const btc = await deposit.getInboundAddress('btc');
      expect(btc?.chain).toBe('BTC');
    });

    it('should return null for unknown chain', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { chain: 'BTC', address: 'bc1q...', halted: false },
        ]),
      });

      const unknown = await deposit.getInboundAddress('SOLANA');
      expect(unknown).toBeNull();
    });

    it('should cache inbound addresses', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([
          { chain: 'BTC', address: 'bc1q...', halted: false },
        ]),
      });

      // First call
      await deposit.getInboundAddress('BTC');
      // Second call should use cache
      await deposit.getInboundAddress('ETH');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
