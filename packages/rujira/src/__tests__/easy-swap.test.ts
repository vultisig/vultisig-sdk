/**
 * Tests for easySwap() method
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EasySwapRequest } from '../easy-routes.js'
import { EASY_ROUTES } from '../easy-routes.js'
import { RujiraError } from '../errors.js'
import { RujiraSwap } from '../modules/swap.js'
import { VALID_THOR_ADDRESS, VALID_THOR_ADDRESS_2 } from './test-helpers.js'

// Mock the client
const createMockClient = () => ({
  config: {
    defaultSlippageBps: 100,
    contracts: {
      finContracts: {
        // Use lowercase FIN-format keys to match EASY_ROUTES format
        'rune/eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'thor1contract...',
        'btc-btc/rune': 'thor1btccontract...',
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
  // Balance checking mocks (added for US-003)
  getAddress: vi.fn().mockResolvedValue('thor1user...'),
  getBalance: vi.fn().mockResolvedValue({
    denom: 'rune',
    amount: '1000000000', // 10 RUNE - sufficient for tests
  }),
})

describe('RujiraSwap.easySwap()', () => {
  let swap: RujiraSwap
  let mockClient: ReturnType<typeof createMockClient>

  beforeEach(() => {
    mockClient = createMockClient()
    swap = new RujiraSwap(mockClient as any, { cache: false })
  })

  describe('route resolution', () => {
    it('should resolve assets from route name', async () => {
      const request: EasySwapRequest = {
        route: 'RUNE_TO_USDC',
        amount: '100000000',
        destination: VALID_THOR_ADDRESS,
      }

      const result = await swap.easySwap(request)

      expect(result.txHash).toBe('TESTHASH123')
      expect(result.fromAmount).toBe('100000000')
      expect(mockClient.simulateSwap).toHaveBeenCalledWith(expect.any(String), expect.any(String), '100000000')
    })

    it('should use direct from/to assets when provided', async () => {
      // Add contract for this pair
      mockClient.config.contracts.finContracts['BTC.BTC/ETH.ETH'] = 'thor1directcontract...'

      const request: EasySwapRequest = {
        from: 'BTC.BTC',
        to: 'ETH.ETH',
        amount: '50000000',
        destination: VALID_THOR_ADDRESS,
      }

      const result = await swap.easySwap(request)

      expect(result.txHash).toBe('TESTHASH123')
      expect(result.fromAmount).toBe('50000000')
    })

    it('should throw error for unknown route name', async () => {
      const request: EasySwapRequest = {
        route: 'INVALID_ROUTE' as any,
        amount: '100000000',
        destination: VALID_THOR_ADDRESS,
      }

      await expect(swap.easySwap(request)).rejects.toThrow(RujiraError)
      await expect(swap.easySwap(request)).rejects.toThrow('Unknown easy route')
    })

    it('should throw error when neither route nor from/to provided', async () => {
      const request: EasySwapRequest = {
        amount: '100000000',
        destination: VALID_THOR_ADDRESS,
      }

      await expect(swap.easySwap(request)).rejects.toThrow(RujiraError)
      await expect(swap.easySwap(request)).rejects.toThrow('must specify either route or both from and to')
    })

    it('should throw error when only from is provided', async () => {
      const request: EasySwapRequest = {
        from: 'BTC.BTC',
        amount: '100000000',
        destination: VALID_THOR_ADDRESS,
      }

      await expect(swap.easySwap(request)).rejects.toThrow(RujiraError)
    })

    it('should throw error when only to is provided', async () => {
      const request: EasySwapRequest = {
        to: 'ETH.ETH',
        amount: '100000000',
        destination: VALID_THOR_ADDRESS,
      }

      await expect(swap.easySwap(request)).rejects.toThrow(RujiraError)
    })
  })

  describe('slippage conversion', () => {
    it('should convert maxSlippagePercent to slippageBps', async () => {
      const request: EasySwapRequest = {
        route: 'RUNE_TO_USDC',
        amount: '100000000',
        destination: VALID_THOR_ADDRESS,
        maxSlippagePercent: 1.5, // 1.5% = 150 bps
      }

      // Spy on getQuote to check the converted slippage
      const getQuoteSpy = vi.spyOn(swap, 'getQuote')

      await swap.easySwap(request)

      expect(getQuoteSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          slippageBps: 150, // 1.5 * 100 = 150
        })
      )
    })

    it('should handle integer slippage percent', async () => {
      const request: EasySwapRequest = {
        route: 'RUNE_TO_USDC',
        amount: '100000000',
        destination: VALID_THOR_ADDRESS,
        maxSlippagePercent: 2, // 2% = 200 bps
      }

      const getQuoteSpy = vi.spyOn(swap, 'getQuote')

      await swap.easySwap(request)

      expect(getQuoteSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          slippageBps: 200,
        })
      )
    })

    it('should use default slippage when not specified', async () => {
      const request: EasySwapRequest = {
        route: 'RUNE_TO_USDC',
        amount: '100000000',
        destination: VALID_THOR_ADDRESS,
      }

      const getQuoteSpy = vi.spyOn(swap, 'getQuote')

      await swap.easySwap(request)

      expect(getQuoteSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          slippageBps: undefined, // Will use default from config
        })
      )
    })

    it('should round fractional bps correctly', async () => {
      const request: EasySwapRequest = {
        route: 'RUNE_TO_USDC',
        amount: '100000000',
        destination: VALID_THOR_ADDRESS,
        maxSlippagePercent: 0.33, // 0.33% = 33 bps
      }

      const getQuoteSpy = vi.spyOn(swap, 'getQuote')

      await swap.easySwap(request)

      expect(getQuoteSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          slippageBps: 33,
        })
      )
    })
  })

  describe('swap execution', () => {
    it('should return SwapResult with correct structure', async () => {
      const request: EasySwapRequest = {
        route: 'RUNE_TO_USDC',
        amount: '100000000',
        destination: VALID_THOR_ADDRESS,
      }

      const result = await swap.easySwap(request)

      expect(mockClient.executeContract).toHaveBeenCalledWith(
        'thor1contract...',
        { swap: { min_return: '98010000', to: VALID_THOR_ADDRESS } },
        [{ denom: 'rune', amount: '100000000' }],
        undefined
      )
      expect(result).toMatchObject({
        txHash: 'TESTHASH123',
        status: 'pending',
        fromAmount: '100000000',
        timestamp: expect.any(Number),
      })
    })

    it('should include destination in quote params', async () => {
      const request: EasySwapRequest = {
        route: 'RUNE_TO_USDC',
        amount: '100000000',
        destination: VALID_THOR_ADDRESS_2,
      }

      const getQuoteSpy = vi.spyOn(swap, 'getQuote')

      await swap.easySwap(request)

      expect(getQuoteSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: VALID_THOR_ADDRESS_2,
        })
      )
    })
  })

  it.each([undefined, VALID_THOR_ADDRESS])(
    'builds flat FIN transaction and memo payloads for %s',
    async destination => {
      const params = { fromAsset: 'rune', toAsset: 'btc-btc', amount: '100000000', destination }
      const expected = { swap: { min_return: '98010000', to: destination } }
      const transaction = await swap.buildTransaction(params)
      expect(transaction.msg).toStrictEqual(expected)
      expect(transaction.funds).toEqual([{ denom: 'rune', amount: '100000000' }])
      const memo = await swap.buildL1Memo(params)
      const [prefix, contract, payload] = memo.split(':')
      expect([prefix, contract]).toEqual(['x', transaction.contractAddress])
      expect(JSON.parse(Buffer.from(payload, 'base64').toString())).toStrictEqual(JSON.parse(JSON.stringify(expected)))
    }
  )

  describe('with the default quote cache', () => {
    const base = { fromAsset: 'rune', toAsset: 'btc-btc', amount: '100000000' }

    it.each([
      [VALID_THOR_ADDRESS, VALID_THOR_ADDRESS_2],
      [VALID_THOR_ADDRESS, undefined],
      [undefined, VALID_THOR_ADDRESS_2],
    ])('sends a swap quoted for %s to the new destination %s', async (previous, next) => {
      const cachedSwap = new RujiraSwap(mockClient as any)
      await cachedSwap.getQuote({ ...base, destination: previous })
      await cachedSwap.executeSwap(next ? { ...base, destination: next } : base)

      expect(mockClient.simulateSwap).toHaveBeenCalledTimes(1)
      expect(mockClient.executeContract.mock.calls[0][1]).toStrictEqual({ swap: { min_return: '98010000', to: next } })
    })

    it('easySwap ignores the destination of a cached quote', async () => {
      const cachedSwap = new RujiraSwap(mockClient as any)
      await cachedSwap.getQuote({ ...base, destination: VALID_THOR_ADDRESS })
      await cachedSwap.easySwap({ from: 'rune', to: 'btc-btc', amount: '100000000', destination: VALID_THOR_ADDRESS_2 })

      expect(mockClient.simulateSwap).toHaveBeenCalledTimes(1)
      expect(mockClient.executeContract.mock.calls[0][1]).toStrictEqual({
        swap: { min_return: '98010000', to: VALID_THOR_ADDRESS_2 },
      })
    })
  })

  describe('all EASY_ROUTES', () => {
    // Test that all defined routes can be resolved
    const routeNames = Object.keys(EASY_ROUTES) as Array<keyof typeof EASY_ROUTES>

    it.each(routeNames)('should resolve route: %s', async routeName => {
      const route = EASY_ROUTES[routeName]

      // Add contract for this pair
      const pairKey = `${route.from}/${route.to}`
      mockClient.config.contracts.finContracts[pairKey] = 'thor1testcontract...'

      const request: EasySwapRequest = {
        route: routeName,
        amount: '100000000',
        destination: VALID_THOR_ADDRESS,
      }

      // Should not throw
      const result = await swap.easySwap(request)
      expect(result.txHash).toBe('TESTHASH123')
    })
  })
})
