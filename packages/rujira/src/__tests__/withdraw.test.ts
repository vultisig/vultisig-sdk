/**
 * Tests for the withdraw module
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RujiraError } from '../errors.js'
import { RujiraWithdraw } from '../modules/withdraw.js'

// Mock the RujiraClient
const createMockClient = (
  options: {
    canSign?: boolean
    signer?: unknown
    address?: string
  } = {}
) => {
  const mockClient = {
    config: {
      restEndpoint: 'https://thornode.example.com',
    },
    canSign: vi.fn().mockReturnValue(options.canSign ?? false),
    getAddress: vi.fn().mockResolvedValue(options.address ?? 'thor1abc...'),
    signer: options.signer,
  }
  return mockClient as unknown as ConstructorParameters<typeof RujiraWithdraw>[0]
}

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('RujiraWithdraw', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('prepare', () => {
    it('should prepare a BTC withdrawal with correct memo format', async () => {
      const client = createMockClient()
      const withdraw = new RujiraWithdraw(client)

      // Mock inbound_addresses response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
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
      })

      const prepared = await withdraw.prepare({
        asset: 'BTC.BTC',
        amount: '1000000',
        l1Address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      })

      expect(prepared.memo).toBe('secure-:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')
      expect(prepared.chain).toBe('BTC')
      expect(prepared.asset).toBe('BTC.BTC')
      expect(prepared.amount).toBe('1000000')
      expect(prepared.destination).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')
      expect(prepared.estimatedTimeMinutes).toBe(30)
    })

    it('should prepare an ETH withdrawal', async () => {
      const client = createMockClient()
      const withdraw = new RujiraWithdraw(client)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              chain: 'ETH',
              address: '0x...',
              halted: false,
              chain_trading_paused: false,
              global_trading_paused: false,
              dust_threshold: '0',
              gas_rate: '50',
              gas_rate_units: 'gwei',
              // THORChain `outbound_fee` is returned in 1e8 units of the chain gas asset
              // (not wei). Keep this realistic to avoid prepare() rejecting tiny amounts.
              outbound_fee: '9146',
            },
          ]),
      })

      const prepared = await withdraw.prepare({
        asset: 'ETH.ETH',
        amount: '5000000000', // 50 ETH in 8 decimals
        l1Address: '0x742d35Cc6634C0532925a3b844Bc9e7595f12345',
      })

      expect(prepared.memo).toBe('secure-:0x742d35Cc6634C0532925a3b844Bc9e7595f12345')
      expect(prepared.chain).toBe('ETH')
      expect(prepared.estimatedTimeMinutes).toBe(5)
    })

    it('should reject invalid asset format', async () => {
      const client = createMockClient()
      const withdraw = new RujiraWithdraw(client)

      await expect(
        withdraw.prepare({
          asset: 'INVALID',
          amount: '1000000',
          l1Address: 'bc1q...',
        })
      ).rejects.toThrow(RujiraError)
    })

    it('should reject invalid BTC address', async () => {
      const client = createMockClient()
      const withdraw = new RujiraWithdraw(client)

      await expect(
        withdraw.prepare({
          asset: 'BTC.BTC',
          amount: '1000000',
          l1Address: 'invalid_address',
        })
      ).rejects.toThrow(RujiraError)
    })

    it('should reject invalid ETH address', async () => {
      const client = createMockClient()
      const withdraw = new RujiraWithdraw(client)

      await expect(
        withdraw.prepare({
          asset: 'ETH.ETH',
          amount: '1000000',
          l1Address: 'not_an_eth_address',
        })
      ).rejects.toThrow(RujiraError)
    })

    it('should reject zero amount', async () => {
      const client = createMockClient()
      const withdraw = new RujiraWithdraw(client)

      await expect(
        withdraw.prepare({
          asset: 'BTC.BTC',
          amount: '0',
          l1Address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        })
      ).rejects.toThrow(RujiraError)
    })
  })

  describe('execute', () => {
    it('should throw if no signer is available', async () => {
      const client = createMockClient({ canSign: false })
      const withdraw = new RujiraWithdraw(client)

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
      }

      await expect(withdraw.execute(prepared)).rejects.toThrow('Cannot execute withdrawal without a signer')
    })

    it('should throw if signer does not support vault access', async () => {
      const mockSigner = {} // No getVault method
      const client = createMockClient({
        canSign: true,
        signer: mockSigner,
      })
      const withdraw = new RujiraWithdraw(client)

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
      }

      await expect(withdraw.execute(prepared)).rejects.toThrow('Withdrawal requires a VultisigRujiraProvider')
    })

    it('should execute withdrawal with valid vault signer', async () => {
      const mockVault = {
        publicKeys: { ecdsa: 'abc123', eddsa: 'def456' },
        address: vi.fn().mockImplementation(async (_chain: string) => 'thor1vaultaddressxyz'),
        prepareThorchainMsgDepositTx: vi.fn().mockResolvedValue({ memo: 'secure-:bc1q...', toAmount: '1000000' }),
        extractMessageHashes: vi.fn().mockResolvedValue(['hash1']),
        sign: vi.fn().mockResolvedValue({ signature: 'sig123', format: 'ECDSA' }),
        broadcastTx: vi.fn().mockResolvedValue('tx_hash_abc'),
      }

      const mockSigner = {
        getVault: () => mockVault,
        getChainId: () => 'thorchain-1',
      }

      const client = createMockClient({
        canSign: true,
        signer: mockSigner,
        address: 'thor1testaddress123',
      })

      const withdraw = new RujiraWithdraw(client)

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
      }

      const result = await withdraw.execute(prepared)

      expect(result.txHash).toBe('tx_hash_abc')
      expect(result.asset).toBe('BTC.BTC')
      expect(result.amount).toBe('1000000')
      expect(result.destination).toBe('bc1q...')
      expect(result.status).toBe('pending')

      // Verify vault methods were called
      expect(mockVault.extractMessageHashes).toHaveBeenCalled()
      expect(mockVault.sign).toHaveBeenCalled()
      expect(mockVault.prepareThorchainMsgDepositTx).toHaveBeenCalledWith({
        chain: 'THORChain',
        amountBaseUnits: 1000000n,
        memo: 'secure-:bc1q...',
        securedWithdrawal: { l1Chain: 'Bitcoin', ticker: 'BTC', destination: 'bc1q...' },
      })
      expect(mockVault.broadcastTx).toHaveBeenCalledWith({
        chain: 'THORChain',
        keysignPayload: { memo: 'secure-:bc1q...', toAmount: '1000000' },
        signature: expect.any(Object),
      })
    })

    it('passes a secured token contract to the SDK deposit helper', async () => {
      const prepareThorchainMsgDepositTx = vi.fn().mockResolvedValue({ memo: 'secure-:0xdestination' })
      const vault = {
        address: vi.fn(),
        prepareThorchainMsgDepositTx,
        extractMessageHashes: vi.fn().mockResolvedValue(['hash']),
        sign: vi.fn().mockResolvedValue({ signature: 'sig', format: 'ECDSA' }),
        broadcastTx: vi.fn().mockResolvedValue('tx'),
      }
      const withdraw = new RujiraWithdraw(
        createMockClient({ canSign: true, signer: { getVault: () => vault, getChainId: () => 'thorchain-1' } })
      )
      await withdraw.execute({
        chain: 'ETH',
        asset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        denom: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        amount: '8000000',
        destination: '0xdestination',
        memo: 'secure-:0xdestination',
        estimatedFee: '100',
        estimatedTimeMinutes: 5,
        funds: [],
      })
      expect(prepareThorchainMsgDepositTx).toHaveBeenCalledWith(
        expect.objectContaining({
          securedWithdrawal: {
            l1Chain: 'Ethereum',
            ticker: 'USDC',
            contractAddress: '0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
            destination: '0xdestination',
          },
        })
      )
    })

    it('rejects a nondefault signer chain before building or signing a withdrawal', async () => {
      const vault = {
        prepareThorchainMsgDepositTx: vi.fn(),
        extractMessageHashes: vi.fn(),
        sign: vi.fn(),
        broadcastTx: vi.fn(),
      }
      const withdraw = new RujiraWithdraw(
        createMockClient({ canSign: true, signer: { getVault: () => vault, getChainId: () => 'thorchain-stagenet-2' } })
      )
      await expect(
        withdraw.execute({
          chain: 'BTC',
          asset: 'BTC.BTC',
          denom: 'btc-btc',
          amount: '1000000',
          destination: 'bc1destination',
          memo: 'secure-:bc1destination',
          estimatedFee: '100',
          estimatedTimeMinutes: 30,
          funds: [],
        })
      ).rejects.toThrow(/require thorchain-1/)
      expect(vault.prepareThorchainMsgDepositTx).not.toHaveBeenCalled()
      expect(vault.sign).not.toHaveBeenCalled()
    })
  })

  describe('buildWithdrawMemo', () => {
    it('should build correct memo format', () => {
      const client = createMockClient()
      const withdraw = new RujiraWithdraw(client)

      const memo = withdraw.buildWithdrawMemo('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')

      expect(memo).toBe('secure-:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')
    })

    it('should build correct memo for ETH address', () => {
      const client = createMockClient()
      const withdraw = new RujiraWithdraw(client)

      const memo = withdraw.buildWithdrawMemo('0x742d35Cc6634C0532925a3b844Bc9e7595f12345')

      expect(memo).toBe('secure-:0x742d35Cc6634C0532925a3b844Bc9e7595f12345')
    })
  })

  describe('estimateWithdrawTime', () => {
    it('should return correct times for known chains', () => {
      const client = createMockClient()
      const withdraw = new RujiraWithdraw(client)

      expect(withdraw.estimateWithdrawTime('BTC')).toBe(30)
      expect(withdraw.estimateWithdrawTime('ETH')).toBe(5)
      expect(withdraw.estimateWithdrawTime('BSC')).toBe(2)
      expect(withdraw.estimateWithdrawTime('AVAX')).toBe(1)
    })

    it('should return default for unknown chains', () => {
      const client = createMockClient()
      const withdraw = new RujiraWithdraw(client)

      expect(withdraw.estimateWithdrawTime('UNKNOWN')).toBe(15)
    })
  })

  describe('canWithdraw', () => {
    it('should return true for active chain', async () => {
      const client = createMockClient()
      const withdraw = new RujiraWithdraw(client)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              chain: 'BTC',
              halted: false,
              chain_trading_paused: false,
              global_trading_paused: false,
            },
          ]),
      })

      const result = await withdraw.canWithdraw('BTC.BTC')
      expect(result.possible).toBe(true)
    })

    it('should return false for halted chain', async () => {
      const client = createMockClient()
      const withdraw = new RujiraWithdraw(client)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              chain: 'BTC',
              halted: true,
              chain_trading_paused: false,
              global_trading_paused: false,
            },
          ]),
      })

      const result = await withdraw.canWithdraw('BTC.BTC')
      expect(result.possible).toBe(false)
      expect(result.reason).toContain('halted')
    })
  })
})
