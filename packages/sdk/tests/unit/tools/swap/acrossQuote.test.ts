import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { acrossQuote, acrossSupportedChains } from '@/tools/swap/acrossQuote'

// USDC Base → USDC Arbitrum is the canonical receipt route. The SDK pins the
// origin to Ethereum for the current factory slice, so the deterministic happy
// path here uses Ethereum → Base while the live receipt script exercises a real
// quote (and is allowed to fail-closed on any upstream schema drift).
const ETH_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

// Pinned SpokePool deployments the live quote MUST echo for the route to pass.
const ETH_SPOKE = '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5'
const BASE_SPOKE = '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64'

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

function validQuoteBody(overrides: Record<string, unknown> = {}) {
  return {
    spokePoolAddress: ETH_SPOKE,
    destinationSpokePoolAddress: BASE_SPOKE,
    outputAmount: '997000',
    estimatedFillTimeSec: 12,
    relayFeeTotal: '2500',
    relayFeePct: '2500000000000000',
    lpFeeTotal: '500',
    isAmountTooLow: false,
    timestamp: '1700000000',
    inputToken: { address: ETH_USDC, symbol: 'USDC', decimals: 6, chainId: 1 },
    outputToken: { address: BASE_USDC, symbol: 'USDC', decimals: 6, chainId: 8453 },
    id: 'quote-123',
    ...overrides,
  }
}

describe('acrossQuote', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes the supported Across chains with Ethereum as the pinned origin', () => {
    expect(acrossSupportedChains).toContain('Ethereum')
    expect(acrossSupportedChains).toContain('Base')
    expect(acrossSupportedChains).toContain('Arbitrum')
  })

  it('returns a normalized read-only quote on a valid route', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(validQuoteBody()))

    const quote = await acrossQuote({
      sourceChain: 'Ethereum',
      destinationChain: 'Base',
      inputToken: ETH_USDC,
      outputToken: BASE_USDC,
      amount: '1000000',
    })

    expect(quote.provider).toBe('across')
    expect(quote.action).toBe('quote_bridge')
    expect(quote.executionStatus).toBe('read_only_quote')
    expect(quote.sourceChainId).toBe(1)
    expect(quote.destinationChainId).toBe(8453)
    expect(quote.inputAmount).toBe('1000000')
    expect(quote.outputAmount).toBe('997000')
    expect(quote.fees.relayFeeTotal).toBe('2500')
    expect(quote.quoteId).toBe('quote-123')

    // outgoing request shape
    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).toContain('/api/suggested-fees?')
    expect(calledUrl).toContain('originChainId=1')
    expect(calledUrl).toContain('destinationChainId=8453')
    expect(calledUrl).toContain('amount=1000000')
  })

  it('checksums the recipient and forwards it for quote simulation', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(validQuoteBody()))

    await acrossQuote({
      sourceChain: 'Ethereum',
      destinationChain: 'Base',
      inputToken: ETH_USDC,
      outputToken: BASE_USDC,
      amount: '1000000',
      to: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    })

    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).toContain('recipient=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
  })

  // Canonical lowercase burn addresses — viem's `isAddress` accepts all-lowercase
  // as a valid (non-checksummed) address, so these pass address validation and
  // MUST be caught by the burn-guard before being forwarded to Across.
  it.each([
    ['0x0000000000000000000000000000000000000000'],
    ['0x000000000000000000000000000000000000dead'],
    ['0xdead000000000000000042069420694206942069'],
  ])('rejects a burn-address recipient (%s) before any network call', async burnRecipient => {
    await expect(
      acrossQuote({
        sourceChain: 'Ethereum',
        destinationChain: 'Base',
        inputToken: ETH_USDC,
        outputToken: BASE_USDC,
        amount: '1000000',
        to: burnRecipient,
      })
    ).rejects.toThrow(/Refusing to build transaction/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a non-Ethereum origin (current factory slice)', async () => {
    await expect(
      acrossQuote({
        sourceChain: 'Base',
        destinationChain: 'Arbitrum',
        inputToken: BASE_USDC,
        outputToken: ETH_USDC,
        amount: '1000000',
      })
    ).rejects.toThrow(/must be Ethereum/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects identical source and destination chains', async () => {
    await expect(
      acrossQuote({
        sourceChain: 'Ethereum',
        destinationChain: 'Ethereum',
        inputToken: ETH_USDC,
        outputToken: BASE_USDC,
        amount: '1000000',
      })
    ).rejects.toThrow(/must be different/)
  })

  it('rejects an invalid input token address before any network call', async () => {
    await expect(
      acrossQuote({
        sourceChain: 'Ethereum',
        destinationChain: 'Base',
        inputToken: 'not-an-address',
        outputToken: BASE_USDC,
        amount: '1000000',
      })
    ).rejects.toThrow(/valid 0x-prefixed EVM address/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a non-integer / non-positive amount', async () => {
    await expect(
      acrossQuote({
        sourceChain: 'Ethereum',
        destinationChain: 'Base',
        inputToken: ETH_USDC,
        outputToken: BASE_USDC,
        amount: '1.5',
      })
    ).rejects.toThrow(/integer string/)

    await expect(
      acrossQuote({
        sourceChain: 'Ethereum',
        destinationChain: 'Base',
        inputToken: ETH_USDC,
        outputToken: BASE_USDC,
        amount: '0',
      })
    ).rejects.toThrow(/must be positive/)
  })

  it('fails closed when the destination SpokePool is missing (schema drift)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(validQuoteBody({ destinationSpokePoolAddress: undefined })))

    await expect(
      acrossQuote({
        sourceChain: 'Ethereum',
        destinationChain: 'Base',
        inputToken: ETH_USDC,
        outputToken: BASE_USDC,
        amount: '1000000',
      })
    ).rejects.toThrow(/unexpected destination SpokePool/)
  })

  it('fails closed when the source SpokePool mismatches the pinned deployment', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(validQuoteBody({ spokePoolAddress: BASE_SPOKE })))

    await expect(
      acrossQuote({
        sourceChain: 'Ethereum',
        destinationChain: 'Base',
        inputToken: ETH_USDC,
        outputToken: BASE_USDC,
        amount: '1000000',
      })
    ).rejects.toThrow(/unexpected source SpokePool/)
  })

  it('rejects a 200 with no usable output amount', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(validQuoteBody({ outputAmount: undefined })))

    await expect(
      acrossQuote({
        sourceChain: 'Ethereum',
        destinationChain: 'Base',
        inputToken: ETH_USDC,
        outputToken: BASE_USDC,
        amount: '1000000',
      })
    ).rejects.toThrow(/no usable outputAmount/)
  })

  it('surfaces upstream HTTP errors', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'bad route',
      json: async () => ({}),
    } as Response)

    await expect(
      acrossQuote({
        sourceChain: 'Ethereum',
        destinationChain: 'Base',
        inputToken: ETH_USDC,
        outputToken: BASE_USDC,
        amount: '1000000',
      })
    ).rejects.toThrow(/HTTP 400/)
  })
})
