import { describe, expect, it } from 'vitest'

import { buildCctpBridge, parseUsdcAmount as parseCctpUsdcAmount } from '@/tools/bridge'
import { buildThreeJaneSupplyUsdc, parseUsdcAmount as parseThreeJaneUsdcAmount } from '@/tools/defi/threeJane'

const SENDER = '0x1111111111111111111111111111111111111111'

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
