import { describe, expect, it } from 'vitest'

import { assertValidPoolId, isValidPoolId } from './pools'

describe('assertValidPoolId / isValidPoolId', () => {
  describe('accepts canonical THORChain pool ids', () => {
    const valid = [
      'BTC.BTC',
      'LTC.LTC',
      'BCH.BCH',
      'DOGE.DOGE',
      'ETH.ETH',
      'BSC.BNB',
      'AVAX.AVAX',
      'GAIA.ATOM',
      // ERC-20-style with contract suffix (uppercase 0x... preserved)
      'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
      'ETH.USDT-0XDAC17F958D2EE523A2206206994597C13D831EC7',
      'BSC.BUSD-0XE9E7CEA3DEDCA5984780BAFC599BD69ADD087D56',
      // Numbers in chain or asset section are valid
      'ETH.4OWL',
    ]
    for (const pool of valid) {
      it(`accepts ${pool}`, () => {
        expect(isValidPoolId(pool)).toBe(true)
        expect(() => assertValidPoolId(pool)).not.toThrow()
      })
    }
  })

  describe('rejects malformed ids', () => {
    const invalid: { input: unknown; reason: string }[] = [
      { input: 'btc.btc', reason: 'lowercase' },
      { input: 'BTC.btc', reason: 'mixed case' },
      { input: 'BTC/BTC', reason: 'slash separator' },
      { input: 'BTC', reason: 'no asset section' },
      { input: '.BTC', reason: 'no chain section' },
      { input: 'BTC.', reason: 'no asset section' },
      { input: 'BTC.BTC.BTC', reason: 'extra section' },
      { input: 'BTC.BTC ', reason: 'trailing space' },
      { input: ' BTC.BTC', reason: 'leading space' },
      { input: '', reason: 'empty string' },
      { input: 'eth.usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', reason: 'lowercase contract section' },
      { input: 'BTC.BTC-', reason: 'trailing dash' },
      { input: undefined as unknown as string, reason: 'undefined' },
      { input: null as unknown as string, reason: 'null' },
      { input: 42 as unknown as string, reason: 'number' },
    ]
    for (const { input, reason } of invalid) {
      it(`rejects ${reason}: ${JSON.stringify(input)}`, () => {
        expect(isValidPoolId(input as string)).toBe(false)
        expect(() => assertValidPoolId(input as string)).toThrow()
      })
    }
  })

  it('error message includes the offending value for diagnostics', () => {
    expect(() => assertValidPoolId('btc.btc')).toThrow(/btc\.btc/)
  })
})
