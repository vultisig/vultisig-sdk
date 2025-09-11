/**
 * Blockchair API Client Tests
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BlockchairClient, blockchairClient } from './index'

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('BlockchairClient', () => {
  let client: BlockchairClient

  beforeEach(() => {
    client = new BlockchairClient()
    mockFetch.mockClear()
  })

  describe('getAddressInfo', () => {
    it('should fetch address information successfully', async () => {
      const mockResponse = {
        data: {
          '0x1234567890123456789012345678901234567890': {
            address: {
              type: 'account',
              balance: '1000000000000000000',
              balance_usd: 2500,
            },
            transactions: ['0xhash1', '0xhash2'],
          },
        },
        context: {
          code: 200,
          source: 'blockchair',
          time: Date.now(),
          limit: 100,
          offset: 0,
          results: 1,
          state: 1,
          cache: {
            live: true,
            duration: 300,
            since: Date.now() - 300000,
            until: Date.now() + 300000,
            time: null,
          },
          api: {
            version: '1.0',
            last_major_update: '2024-01-01',
            next_major_update: null,
            documentation: 'https://blockchair.com/api/docs',
          },
        },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const result = await client.getAddressInfo(
        'ethereum',
        '0x1234567890123456789012345678901234567890'
      )

      expect(result).toBeDefined()
      expect(result.address.balance).toBe('1000000000000000000')
      expect(result.address.balance_usd).toBe(2500)
      expect(result.transactions).toEqual(['0xhash1', '0xhash2'])
    })

    it('should throw error for non-existent address', async () => {
      const mockResponse = {
        data: {},
        context: { code: 404 },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      await expect(
        client.getAddressInfo('ethereum', '0xnonexistent')
      ).rejects.toThrow('Address 0xnonexistent not found on ethereum')
    })

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(client.getAddressInfo('ethereum', '0x1234')).rejects.toThrow(
        'Network error'
      )
    })
  })

  describe('getTransactionInfo', () => {
    it('should fetch transaction information successfully', async () => {
      const mockResponse = {
        data: {
          '0xhash123': {
            transaction: {
              block_id: 18500000,
              hash: '0xhash123',
              time: '2024-01-01T12:00:00Z',
              fee: '21000000000000',
              fee_usd: 0.5,
            },
            inputs: [],
            outputs: [],
          },
        },
        context: { code: 200 },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const result = await client.getTransactionInfo('ethereum', '0xhash123')

      expect(result.transaction.hash).toBe('0xhash123')
      expect(result.transaction.block_id).toBe(18500000)
      expect(result.transaction.fee).toBe('21000000000000')
    })
  })

  describe('getStats', () => {
    it('should fetch blockchain statistics', async () => {
      const mockResponse = {
        data: {
          blocks: 850000,
          transactions: 125000000,
          market_price_usd: 45000,
          hashrate_24h: '500 EH/s',
        },
        context: { code: 200 },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const result = await client.getStats('bitcoin')

      expect(result.blocks).toBe(850000)
      expect(result.transactions).toBe(125000000)
      expect(result.market_price_usd).toBe(45000)
      expect(result.hashrate_24h).toBe('500 EH/s')
    })
  })

  describe('getAddressesInfo', () => {
    it('should fetch multiple addresses in batch', async () => {
      const mockResponse = {
        data: {
          '0xaddr1': { address: { balance: '1000000000000000000' } },
          '0xaddr2': { address: { balance: '2000000000000000000' } },
        },
        context: { code: 200 },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const result = await client.getAddressesInfo('ethereum', [
        '0xaddr1',
        '0xaddr2',
      ])

      expect(Object.keys(result)).toHaveLength(2)
      expect(result['0xaddr1'].address.balance).toBe('1000000000000000000')
      expect(result['0xaddr2'].address.balance).toBe('2000000000000000000')
    })

    it('should return empty object for empty address list', async () => {
      const result = await client.getAddressesInfo('ethereum', [])
      expect(result).toEqual({})
    })
  })

  describe('broadcastTransaction', () => {
    it('should broadcast transaction successfully', async () => {
      const rawTx = '0200000001...'
      const mockResponse = {
        data: { txid: 'abc123def456' },
        context: { code: 200 },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      })

      const result = await client.broadcastTransaction('bitcoin', rawTx)

      expect(result.txid).toBe('abc123def456')
    })
  })
})

describe('blockchairClient singleton', () => {
  it('should be an instance of BlockchairClient', () => {
    expect(blockchairClient).toBeInstanceOf(BlockchairClient)
  })

  it('should have default configuration', () => {
    expect(blockchairClient).toBeDefined()
  })
})
