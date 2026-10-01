import { describe, expect, it } from 'vitest'

import { buildCctpBridge, formatUsdc as formatCctpUsdc, parseUsdcAmount as parseCctpUsdcAmount } from '@/tools/bridge'
import { formatUsdc, parseUsdcAmount } from '@/tools/parse/usdcAmount'

const SENDER = '0x1111111111111111111111111111111111111111'

describe('shared formatUsdc (sdk#1931)', () => {
  it('uses the canonical implementation for CCTP', () => {
    expect(formatCctpUsdc).toBe(formatUsdc)
  })

  it('is the exact inverse of parseUsdcAmount', () => {
    for (const value of ['1', '0.1', '0.000001', '1000', '1234.567891', '0.5']) {
      expect(formatUsdc(parseUsdcAmount(value))).toBe(value)
    }
  })

  it('renders whole amounts without a decimal point and trims trailing zeros', () => {
    expect(formatUsdc(1_000_000n)).toBe('1')
    expect(formatUsdc(0n)).toBe('0')
    expect(formatUsdc(1_500_000n)).toBe('1.5')
    expect(formatUsdc(1n)).toBe('0.000001')
    expect(formatUsdc(1_000_000_000_000n)).toBe('1000000')
  })
})

describe('shared parseUsdcAmount', () => {
  it.each(['+1', '-1', '1e3', '1_000', '1a'])('rejects signed or non-digit input %s through CCTP', value => {
    expect(() => parseCctpUsdcAmount(value)).toThrow()
    expect(() =>
      buildCctpBridge({ sourceChain: 'Base', destinationChain: 'Arbitrum', amount: value, from: SENDER })
    ).toThrow()
  })
})
