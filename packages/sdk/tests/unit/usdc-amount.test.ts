import { describe, expect, it } from 'vitest'

import { buildCctpBridge, formatUsdc as formatCctpUsdc, parseUsdcAmount as parseCctpUsdcAmount } from '@/tools/bridge'
import {
  buildThreeJaneSupplyUsdc,
  formatUsdc as formatThreeJaneUsdc,
  parseUsdcAmount as parseThreeJaneUsdcAmount,
} from '@/tools/defi/threeJane'
import { formatUsdc, parseUsdcAmount } from '@/tools/parse/usdcAmount'

const SENDER = '0x1111111111111111111111111111111111111111'

describe('shared formatUsdc (sdk#1931)', () => {
  // parseUsdcAmount was already shared; formatUsdc - its inverse - was copied
  // into buildCctpBridge.ts and threeJane/buildSupplyUsdc.ts independently. The
  // two copies still agreed, but this is the helper that renders the
  // `amountUsdc` string a user reads on a signing card, so a drift would show
  // the same amount two different ways depending on which builder produced it.
  it('uses one implementation for CCTP and ThreeJane', () => {
    expect(formatCctpUsdc).toBe(formatUsdc)
    expect(formatThreeJaneUsdc).toBe(formatUsdc)
    expect(formatCctpUsdc).toBe(formatThreeJaneUsdc)
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
  it('uses one implementation for CCTP and ThreeJane', () => {
    expect(parseCctpUsdcAmount).toBe(parseThreeJaneUsdcAmount)
  })

  it.each(['+1', '-1', '1e3', '1_000', '1a'])('rejects signed or non-digit input %s through both callers', value => {
    expect(() => parseCctpUsdcAmount(value)).toThrow()
    expect(() => parseThreeJaneUsdcAmount(value)).toThrow()
    expect(() =>
      buildCctpBridge({ sourceChain: 'Base', destinationChain: 'Arbitrum', amount: value, from: SENDER })
    ).toThrow()
    expect(() => buildThreeJaneSupplyUsdc({ from: SENDER, amount: value })).toThrow()
  })
})
