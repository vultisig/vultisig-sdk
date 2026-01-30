/**
 * Tests for the withdraw module
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RujiraWithdraw } from '../modules/withdraw';
import { RujiraError, RujiraErrorCode } from '../errors';

// Mock the RujiraClient
const createMockClient = (options: {
  canSign?: boolean;
  signer?: unknown;
  address?: string;
} = {}) => {
  const mockClient = {
    config: {
      restEndpoint: 'https://thornode.example.com',
    },
    canSign: vi.fn().mockReturnValue(options.canSign ?? false),
    getAddress: vi.fn().mockResolvedValue(options.address ?? 'thor1abc...'),
    signer: options.signer,
  };
  return mockClient as unknown as Parameters<typeof RujiraWithdraw.prototype.constructor>[0];
};

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('RujiraWithdraw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('prepare', () => {
    it('should prepare a BTC withdrawal with correct memo format', async () => {
      const client = createMockClient();
      const withdraw = new RujiraWithdraw(client);

      // Mock inbound_addresses response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          {
            chain: 'BTC',
            address: 'bc1q...',
            halted: false,
            chain_trading_paused: false,
            global_trading_paused: false,
            dust_threshold: '10000',
            gas_rate: '25',
            gas_rate_units: 'satsperbyte',
            outbound_fee: '30000',
          },
        ]),
      });

      const prepared = await withdraw.prepare({
        asset: 'BTC.BTC',
        amount: '1000000',
        l1Address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      });

      expect(prepared.memo).toBe('secure-:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
      expect(prepared.chain).toBe('BTC');
      expect(prepared.asset).toBe('BTC.BTC');
      expect(prepared.amount).toBe('1000000');
      expect(prepared.destination).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
      expect(prepared.estimatedTimeMinutes).toBe(30);
    });

    it('should prepare an ETH withdrawal', async () => {
      const client = createMockClient();
      const withdraw = new RujiraWithdraw(client);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          {
            chain: 'ETH',
            address: '0x...',
            halted: false,
            chain_trading_paused: false,
            global_trading_paused: false,
            dust_threshold: '0',
            gas_rate: '50',
            gas_rate_units: 'gwei',
            outbound_fee: '2400000000000000',
          },
        ]),
      });

      const prepared = await withdraw.prepare({
        asset: 'ETH.ETH',
        amount: '5000000000', // 50 ETH in 8 decimals
        l1Address: '0x742d35Cc6634C0532925a3b844Bc9e7595f12345',
      });

      expect(prepared.memo).toBe('secure-:0x742d35Cc6634C0532925a3b844Bc9e7595f12345');
      expect(prepared.chain).toBe('ETH');
      expect(prepared.estimatedTimeMinutes).toBe(5);
    });

    it('should reject invalid asset format', async () => {
      const client = createMockClient();
      const withdraw = new RujiraWithdraw(client);

      await expect(
        withdraw.prepare({
          asset: 'INVALID',
          amount: '1000000',
          l1Address: 'bc1q...',
        })
      ).rejects.toThrow(RujiraError);
    });

    it('should reject invalid BTC address', async () => {
      const client = createMockClient();
      const withdraw = new RujiraWithdraw(client);

      await expect(
        withdraw.prepare({
          asset: 'BTC.BTC',
          amount: '1000000',
          l1Address: 'invalid_address',
        })
      ).rejects.toThrow(RujiraError);
    });

    it('should reject invalid ETH address', async () => {
      const client = createMockClient();
      const withdraw = new RujiraWithdraw(client);

      await expect(
        withdraw.prepare({
          asset: 'ETH.ETH',
          amount: '1000000',
          l1Address: 'not_an_eth_address',
        })
      ).rejects.toThrow(RujiraError);
    });

    it('should reject zero amount', async () => {
      const client = createMockClient();
      const withdraw = new RujiraWithdraw(client);

      await expect(
        withdraw.prepare({
          asset: 'BTC.BTC',
          amount: '0',
          l1Address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        })
      ).rejects.toThrow(RujiraError);
    });
  });

  describe('execute', () => {
    it('should throw if no signer is available', async () => {
      const client = createMockClient({ canSign: false });
      const withdraw = new RujiraWithdraw(client);

      const prepared = {
        chain: 'BTC',
        asset: 'BTC.BTC',
        denom: 'btc/btc',
        amount: '1000000',
        destination: 'bc1q...',
        memo: 'secure-:bc1q...',
        estimatedFee: '30000',
        estimatedTimeMinutes: 30,
        funds: [{ denom: 'btc/btc', amount: '1000000' }],
      };

      await expect(withdraw.execute(prepared)).rejects.toThrow(
        'Cannot execute withdrawal without a signer'
      );
    });

    it('should throw if signer does not support vault access', async () => {
      const mockSigner = {}; // No getVault method
      const client = createMockClient({
        canSign: true,
        signer: mockSigner,
      });
      const withdraw = new RujiraWithdraw(client);

      const prepared = {
        chain: 'BTC',
        asset: 'BTC.BTC',
        denom: 'btc/btc',
        amount: '1000000',
        destination: 'bc1q...',
        memo: 'secure-:bc1q...',
        estimatedFee: '30000',
        estimatedTimeMinutes: 30,
        funds: [{ denom: 'btc/btc', amount: '1000000' }],
      };

      await expect(withdraw.execute(prepared)).rejects.toThrow(
        'Withdrawal requires a VultisigRujiraProvider'
      );
    });

    it('should execute withdrawal with valid vault signer', async () => {
      const mockVault = {
        publicKeys: { ecdsa: 'abc123', eddsa: 'def456' },
        address: vi.fn().mockImplementation(async (_chain: string) => 'thor1vaultaddressxyz'),
        prepareSignDirectTx: vi.fn().mockResolvedValue({
          coin: { hexPublicKey: 'abc123' },
          vaultLocalPartyId: 'local-party-1',
          libType: 'GG20',
        }),
        extractMessageHashes: vi.fn().mockResolvedValue(['hash1']),
        sign: vi.fn().mockResolvedValue({ signature: 'sig123', format: 'ECDSA' }),
        broadcastTx: vi.fn().mockResolvedValue('tx_hash_abc'),
      };

      const mockSigner = {
        getVault: () => mockVault,
      };

      const client = createMockClient({
        canSign: true,
        signer: mockSigner,
        address: 'thor1testaddress123',
      });

      const withdraw = new RujiraWithdraw(client);

      // Mock account info fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          account: {
            account_number: '12345',
            sequence: '5',
          },
        }),
      });

      // Mock network info fetch for fee
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          native_tx_fee_rune: '2000000',
        }),
      });

      const prepared = {
        chain: 'BTC',
        asset: 'BTC.BTC',
        denom: 'btc/btc',
        amount: '1000000',
        destination: 'bc1q...',
        memo: 'secure-:bc1q...',
        estimatedFee: '30000',
        estimatedTimeMinutes: 30,
        funds: [{ denom: 'btc/btc', amount: '1000000' }],
      };

      const result = await withdraw.execute(prepared);

      expect(result.txHash).toBe('tx_hash_abc');
      expect(result.asset).toBe('BTC.BTC');
      expect(result.amount).toBe('1000000');
      expect(result.destination).toBe('bc1q...');
      expect(result.status).toBe('pending');

      // Verify vault methods were called
      expect(mockVault.extractMessageHashes).toHaveBeenCalled();
      expect(mockVault.sign).toHaveBeenCalled();
      expect(mockVault.broadcastTx).toHaveBeenCalledWith({
        chain: 'THORChain',
        keysignPayload: expect.objectContaining({
          memo: 'secure-:bc1q...',
          toAmount: '1000000',
          blockchainSpecific: expect.objectContaining({
            case: 'thorchainSpecific',
            value: expect.objectContaining({
              isDeposit: true,
            }),
          }),
        }),
        signature: expect.any(Object),
      });
    });
  });

  describe('buildWithdrawMemo', () => {
    it('should build correct memo format', () => {
      const client = createMockClient();
      const withdraw = new RujiraWithdraw(client);

      const memo = withdraw.buildWithdrawMemo(
        'BTC.BTC',
        'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
      );

      expect(memo).toBe('secure-:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    });

    it('should uppercase the asset', () => {
      const client = createMockClient();
      const withdraw = new RujiraWithdraw(client);

      const memo = withdraw.buildWithdrawMemo(
        'eth.eth',
        '0x742d35Cc6634C0532925a3b844Bc9e7595f12345'
      );

      expect(memo).toBe('secure-:0x742d35Cc6634C0532925a3b844Bc9e7595f12345');
    });
  });

  describe('estimateWithdrawTime', () => {
    it('should return correct times for known chains', () => {
      const client = createMockClient();
      const withdraw = new RujiraWithdraw(client);

      expect(withdraw.estimateWithdrawTime('BTC')).toBe(30);
      expect(withdraw.estimateWithdrawTime('ETH')).toBe(5);
      expect(withdraw.estimateWithdrawTime('BSC')).toBe(2);
      expect(withdraw.estimateWithdrawTime('AVAX')).toBe(1);
    });

    it('should return default for unknown chains', () => {
      const client = createMockClient();
      const withdraw = new RujiraWithdraw(client);

      expect(withdraw.estimateWithdrawTime('UNKNOWN')).toBe(15);
    });
  });

  describe('canWithdraw', () => {
    it('should return true for active chain', async () => {
      const client = createMockClient();
      const withdraw = new RujiraWithdraw(client);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          {
            chain: 'BTC',
            halted: false,
            chain_trading_paused: false,
            global_trading_paused: false,
          },
        ]),
      });

      const result = await withdraw.canWithdraw('BTC.BTC');
      expect(result.possible).toBe(true);
    });

    it('should return false for halted chain', async () => {
      const client = createMockClient();
      const withdraw = new RujiraWithdraw(client);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          {
            chain: 'BTC',
            halted: true,
            chain_trading_paused: false,
            global_trading_paused: false,
          },
        ]),
      });

      const result = await withdraw.canWithdraw('BTC.BTC');
      expect(result.possible).toBe(false);
      expect(result.reason).toContain('halted');
    });
  });
});
