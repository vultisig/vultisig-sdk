import { describe, expect, it } from 'vitest'

import {
  COWSWAP_APP_CODE,
  COWSWAP_APP_VERSION,
  COWSWAP_DEFAULT_AFFILIATE_BPS,
  COWSWAP_FEE_RECIPIENT,
  COWSWAP_VALID_TO_SECONDS,
} from '../../config'
import { CowSwapQuoteApiResponse } from '../../types'
import { buildCowSwapAppData, buildCowSwapOrder, CowSwapOrder, keccak256Hex } from '../buildCowSwapOrder'

function makeQuoteResponse(overrides?: Partial<CowSwapQuoteApiResponse['quote']>): CowSwapQuoteApiResponse {
  return {
    quote: {
      sellToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      buyToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      receiver: '0xreceiver',
      sellAmount: '1000000000000000000',
      buyAmount: '990000000',
      validTo: Math.floor(Date.now() / 1000) + 900,
      appData: '{}',
      feeAmount: '10000000000000000',
      kind: 'sell' as const,
      partiallyFillable: false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
      ...overrides,
    },
    from: '0xsender',
    expiration: new Date(Date.now() + 900_000).toISOString(),
    id: 1,
  }
}

describe('keccak256Hex', () => {
  it('returns a 0x-prefixed 64-char hex string', () => {
    const hash = keccak256Hex('hello')
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('is deterministic for the same input', () => {
    const input = '{"appCode":"vultisig","version":"0.1.0"}'
    expect(keccak256Hex(input)).toBe(keccak256Hex(input))
  })

  it('produces different hashes for different inputs', () => {
    expect(keccak256Hex('aaa')).not.toBe(keccak256Hex('bbb'))
  })

  it('matches the known keccak256 of empty string', () => {
    // keccak256("") = 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470
    expect(keccak256Hex('')).toBe('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
  })
})

describe('buildCowSwapAppData', () => {
  it('produces valid JSON', () => {
    const raw = buildCowSwapAppData(50, COWSWAP_FEE_RECIPIENT)
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  it('includes expected fields', () => {
    const raw = buildCowSwapAppData(75, COWSWAP_FEE_RECIPIENT)
    const parsed = JSON.parse(raw)
    expect(parsed.appCode).toBe(COWSWAP_APP_CODE)
    expect(parsed.version).toBe(COWSWAP_APP_VERSION)
    expect(parsed.metadata.partnerFee.bps).toBe(75)
    expect(parsed.metadata.partnerFee.recipient).toBe(COWSWAP_FEE_RECIPIENT.toLowerCase())
  })

  it('lowercases the fee recipient address', () => {
    const mixed = '0xAaBbCcDdEeFf0011223344556677889900AABBCC'
    const parsed = JSON.parse(buildCowSwapAppData(50, mixed))
    expect(parsed.metadata.partnerFee.recipient).toBe(mixed.toLowerCase())
  })

  it('output differs when bps changes', () => {
    expect(buildCowSwapAppData(50, COWSWAP_FEE_RECIPIENT)).not.toBe(buildCowSwapAppData(0, COWSWAP_FEE_RECIPIENT))
  })

  it('uses COWSWAP_DEFAULT_AFFILIATE_BPS when called with default', () => {
    const raw = buildCowSwapAppData(COWSWAP_DEFAULT_AFFILIATE_BPS, COWSWAP_FEE_RECIPIENT)
    const parsed = JSON.parse(raw)
    expect(parsed.metadata.partnerFee.bps).toBe(COWSWAP_DEFAULT_AFFILIATE_BPS)
  })
})

describe('buildCowSwapOrder', () => {
  it('maps quote fields through correctly', () => {
    const quoteResponse = makeQuoteResponse()
    const order = buildCowSwapOrder({ quoteResponse, receiver: '0xMyReceiver' })

    expect(order.sellToken).toBe('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')
    expect(order.buyToken).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
    expect(order.receiver).toBe('0xMyReceiver')
    expect(order.sellAmount).toBe('1000000000000000000')
    expect(order.buyAmount).toBe('990000000')
    expect(order.feeAmount).toBe('10000000000000000')
    expect(order.kind).toBe('sell')
    expect(order.partiallyFillable).toBe(false)
  })

  it('sets sellTokenBalance and buyTokenBalance to erc20', () => {
    const order = buildCowSwapOrder({ quoteResponse: makeQuoteResponse(), receiver: '0xr' })
    expect(order.sellTokenBalance).toBe('erc20')
    expect(order.buyTokenBalance).toBe('erc20')
  })

  it('sets validTo ~15 minutes from now', () => {
    const nowBefore = Math.floor(Date.now() / 1000)
    const order = buildCowSwapOrder({ quoteResponse: makeQuoteResponse(), receiver: '0xr' })
    const nowAfter = Math.floor(Date.now() / 1000)

    expect(order.validTo).toBeGreaterThanOrEqual(nowBefore + COWSWAP_VALID_TO_SECONDS)
    expect(order.validTo).toBeLessThanOrEqual(nowAfter + COWSWAP_VALID_TO_SECONDS)
  })

  it('computes appDataHash as a valid 0x hex string', () => {
    const order = buildCowSwapOrder({ quoteResponse: makeQuoteResponse(), receiver: '0xr' })
    expect(order.appDataHash).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('appData and appDataHash are consistent', () => {
    const order: CowSwapOrder = buildCowSwapOrder({ quoteResponse: makeQuoteResponse(), receiver: '0xr' })
    expect(order.appDataHash).toBe(keccak256Hex(order.appData))
  })

  it('uses default bps when affiliateBps is omitted', () => {
    const order = buildCowSwapOrder({ quoteResponse: makeQuoteResponse(), receiver: '0xr' })
    const parsed = JSON.parse(order.appData)
    expect(parsed.metadata.partnerFee.bps).toBe(COWSWAP_DEFAULT_AFFILIATE_BPS)
  })

  it('uses explicit affiliateBps when provided', () => {
    const order = buildCowSwapOrder({ quoteResponse: makeQuoteResponse(), receiver: '0xr', affiliateBps: 0 })
    const parsed = JSON.parse(order.appData)
    expect(parsed.metadata.partnerFee.bps).toBe(0)
  })

  it('appData differs between different affiliateBps values', () => {
    const order50 = buildCowSwapOrder({ quoteResponse: makeQuoteResponse(), receiver: '0xr', affiliateBps: 50 })
    const order0 = buildCowSwapOrder({ quoteResponse: makeQuoteResponse(), receiver: '0xr', affiliateBps: 0 })
    expect(order50.appData).not.toBe(order0.appData)
    expect(order50.appDataHash).not.toBe(order0.appDataHash)
  })
})
