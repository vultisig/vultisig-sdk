import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  COWSWAP_DEFAULT_AFFILIATE_BPS,
  COWSWAP_FEE_RECIPIENT,
  cowSwapChainConfig,
  cowSwapSupportedChains,
  KNOWN_PERMIT_TOKENS,
} from '../../config'
import { buildCowSwapAppData, keccak256Hex } from '../../sign/buildCowSwapOrder'
import { getCowSwapQuote } from '../getCowSwapQuote'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

function makeQuoteResponse(chainId: number, buyAmount = '990000000000000000') {
  return {
    quote: {
      sellToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      buyToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      receiver: '0xreceiver',
      sellAmount: '1000000000000000000',
      buyAmount,
      validTo: Math.floor(Date.now() / 1000) + 900,
      appData: '{}',
      feeAmount: '10000000000000000',
      kind: 'sell' as const,
      partiallyFillable: false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
    },
    from: '0xsender',
    expiration: new Date(Date.now() + 900_000).toISOString(),
    id: chainId,
  }
}

const baseInput = {
  sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  sellAmount: 1_000_000_000_000_000_000n,
  from: '0xSender',
  receiver: '0xReceiver',
}

describe('getCowSwapQuote', () => {
  beforeEach(() => {
    vi.mocked(queryUrl).mockReset()
  })

  it('returns dstAmount from quote.buyAmount', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce(makeQuoteResponse(1, '990000000'))

    const quote = await getCowSwapQuote({
      ...baseInput,
      chainConfig: cowSwapChainConfig.Ethereum,
    })

    expect(quote.dstAmount).toBe('990000000')
    expect(quote.provider).toBe('cowswap')
  })

  it('encodes cowswap_order tx arm with all required fields', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce(makeQuoteResponse(1))

    const quote = await getCowSwapQuote({
      ...baseInput,
      chainConfig: cowSwapChainConfig.Ethereum,
    })

    if (!('cowswap_order' in quote.tx)) {
      throw new Error('Expected cowswap_order tx arm')
    }
    // TypeScript narrows quote.tx to { cowswap_order: {...} } after the in-check above.
    const order = (quote.tx as Extract<typeof quote.tx, { cowswap_order: unknown }>).cowswap_order
    expect(order.sellToken).toBe('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')
    expect(order.buyToken).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
    expect(order.chainId).toBe(1)
    expect(order.apiBase).toBe('https://api.cow.fi/mainnet')
    expect(order.partiallyFillable).toBe(false)
    expect(order.kind).toBe('sell')
    expect(order.sellTokenBalance).toBe('erc20')
    expect(order.buyTokenBalance).toBe('erc20')
  })

  // The CoW orderbook rejects orders with a non-zero fee (`NonZeroFee` / "Fee
  // must be zero"). The order must carry feeAmount '0' and sell the GROSS amount
  // (quote.sellAmount + quote.feeAmount); the fee is recovered from surplus.
  it('builds a fee-less order: feeAmount 0 and gross sellAmount', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce(makeQuoteResponse(1))

    const quote = await getCowSwapQuote({
      ...baseInput,
      chainConfig: cowSwapChainConfig.Ethereum,
    })

    if (!('cowswap_order' in quote.tx)) {
      throw new Error('Expected cowswap_order')
    }
    // makeQuoteResponse: sellAmount 1e18 + feeAmount 1e16 = 1.01e18 gross.
    expect(quote.tx.cowswap_order.feeAmount).toBe('0')
    expect(quote.tx.cowswap_order.sellAmount).toBe('1010000000000000000')
  })

  it('appData hash varies with affiliateBps (50 bps vs 0 bps)', async () => {
    vi.mocked(queryUrl).mockResolvedValue(makeQuoteResponse(1))

    const quote50 = await getCowSwapQuote({
      ...baseInput,
      chainConfig: cowSwapChainConfig.Ethereum,
      affiliateBps: 50,
    })

    const quote0 = await getCowSwapQuote({
      ...baseInput,
      chainConfig: cowSwapChainConfig.Ethereum,
      affiliateBps: 0,
    })

    expect('cowswap_order' in quote50.tx).toBe(true)
    expect('cowswap_order' in quote0.tx).toBe(true)

    if (!('cowswap_order' in quote50.tx) || !('cowswap_order' in quote0.tx)) {
      throw new Error('Expected cowswap_order')
    }

    // appData and appDataHash should differ between 50 bps and 0 bps
    expect(quote50.tx.cowswap_order.appData).not.toBe(quote0.tx.cowswap_order.appData)
    expect(quote50.tx.cowswap_order.appDataHash).not.toBe(quote0.tx.cowswap_order.appDataHash)
  })

  it('appData hash is deterministic for the same (bps, recipient)', async () => {
    const appData = buildCowSwapAppData(50, COWSWAP_FEE_RECIPIENT)
    const hash1 = keccak256Hex(appData)
    const hash2 = keccak256Hex(appData)

    expect(hash1).toBe(hash2)
    expect(hash1).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it.each([
    ['Ethereum', 1, 'https://api.cow.fi/mainnet'],
    ['Arbitrum', 42161, 'https://api.cow.fi/arbitrum_one'],
    ['Base', 8453, 'https://api.cow.fi/base'],
    ['Avalanche', 43114, 'https://api.cow.fi/avalanche'],
  ] as const)('hits correct API base for %s (chainId=%i)', async (chainName, chainId, expectedBase) => {
    vi.mocked(queryUrl).mockResolvedValueOnce(makeQuoteResponse(chainId))

    const chain = cowSwapSupportedChains.find(c => c === chainName)!
    await getCowSwapQuote({
      ...baseInput,
      chainConfig: cowSwapChainConfig[chain],
    })

    const [url] = vi.mocked(queryUrl).mock.calls[0]
    expect(url).toBe(`${expectedBase}/api/v1/quote`)
  })

  it('sets permitRequired=true for USDC on Ethereum (known permit token)', async () => {
    const usdcEthereum = KNOWN_PERMIT_TOKENS[1][0]
    vi.mocked(queryUrl).mockResolvedValueOnce(makeQuoteResponse(1))

    const quote = await getCowSwapQuote({
      ...baseInput,
      sellToken: usdcEthereum,
      chainConfig: cowSwapChainConfig.Ethereum,
    })

    if (!('cowswap_order' in quote.tx)) {
      throw new Error('Expected cowswap_order')
    }
    expect(quote.tx.cowswap_order.permitRequired).toBe(true)
  })

  it('does not set permitRequired for a non-permit token', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce(makeQuoteResponse(1))

    // WETH is not in the permit allowlist
    const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    const quote = await getCowSwapQuote({
      ...baseInput,
      sellToken: weth,
      chainConfig: cowSwapChainConfig.Ethereum,
    })

    if (!('cowswap_order' in quote.tx)) {
      throw new Error('Expected cowswap_order')
    }
    expect(quote.tx.cowswap_order.permitRequired).toBeUndefined()
  })

  // Regression guard: the permit allowlist must contain ONLY tokens that
  // implement the canonical EIP-2612 Permit struct. Maker-style permit tokens
  // (mainnet DAI) and no-permit tokens (mainnet USDT) must NOT be flagged
  // `permitRequired`, otherwise Phase 2 would build an EIP-2612 signature the
  // token can't honor and the CowSwap order fails at settlement. (#584 — Claude)
  it.each([
    ['mainnet DAI (Maker-style permit, not EIP-2612)', '0x6B175474E89094C44Da98b954EedeAC495271d0F'],
    ['mainnet USDT (no EIP-2612 permit)', '0xdAC17F958D2ee523a2206206994597C13D831ec7'],
  ])('does not flag permitRequired for %s', async (_label, sellToken) => {
    vi.mocked(queryUrl).mockResolvedValueOnce(makeQuoteResponse(1))

    const quote = await getCowSwapQuote({
      ...baseInput,
      sellToken,
      chainConfig: cowSwapChainConfig.Ethereum,
    })

    if (!('cowswap_order' in quote.tx)) {
      throw new Error('Expected cowswap_order')
    }
    expect(quote.tx.cowswap_order.permitRequired).toBeUndefined()
  })

  it('every token in KNOWN_PERMIT_TOKENS is non-empty and 0x-prefixed', () => {
    for (const [, tokens] of Object.entries(KNOWN_PERMIT_TOKENS)) {
      for (const addr of tokens) {
        expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/)
      }
    }
    // mainnet allowlist must not contain the excluded non-EIP-2612 entries.
    const mainnet = KNOWN_PERMIT_TOKENS[1].map(a => a.toLowerCase())
    expect(mainnet).not.toContain('0x6b175474e89094c44da98b954eedeac495271d0f') // DAI
    expect(mainnet).not.toContain('0xdac17f958d2ee523a2206206994597c13d831ec7') // USDT
  })

  it('uses COWSWAP_DEFAULT_AFFILIATE_BPS when affiliateBps is not provided', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce(makeQuoteResponse(1))

    await getCowSwapQuote({
      ...baseInput,
      chainConfig: cowSwapChainConfig.Ethereum,
    })

    const [, options] = vi.mocked(queryUrl).mock.calls[0]
    const body = options?.body as Record<string, unknown>
    const appData = body.appData as string

    const expectedAppData = buildCowSwapAppData(COWSWAP_DEFAULT_AFFILIATE_BPS, COWSWAP_FEE_RECIPIENT)
    expect(appData).toBe(expectedAppData)
  })
})
