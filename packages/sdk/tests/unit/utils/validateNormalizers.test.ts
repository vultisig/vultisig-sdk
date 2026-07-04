import { describe, expect, it } from 'vitest'

import {
  amountMatches,
  computeEvmFee,
  decimalsFor,
  feeMatches,
  isValidTokenSymbolFormat,
  normalizeTokenSymbol,
  scaleHumanToRaw,
  scaleRawToHuman,
  tokenDecimals,
  ValidateNormalizerError,
} from '../../../src/utils/validateNormalizers'

describe('scaleRawToHuman', () => {
  it('scales the CACAO golden case exactly (220208030381 @ decimals=10)', () => {
    // The classic decimals.go drift case: raw=220208030381, to_decimals=10
    // should render 22.0208030381 CACAO — NOT ~0.000220208030381.
    expect(scaleRawToHuman('220208030381', 10)).toBe('22.0208030381')
  })

  it('trims trailing zeros and drops a bare fraction', () => {
    expect(scaleRawToHuman('1000000', 6)).toBe('1')
    expect(scaleRawToHuman('1500000', 6)).toBe('1.5')
    expect(scaleRawToHuman('0', 18)).toBe('0')
  })

  it('handles sub-one amounts (1 wei @ 18)', () => {
    expect(scaleRawToHuman('1', 18)).toBe('0.000000000000000001')
  })

  it('accepts bigint input and preserves >2^53 precision', () => {
    expect(scaleRawToHuman(123456789012345678901n, 18)).toBe('123.456789012345678901')
  })

  it('handles negative raw amounts', () => {
    expect(scaleRawToHuman('-220208030381', 10)).toBe('-22.0208030381')
  })

  it('rejects non-integer base-unit strings', () => {
    expect(() => scaleRawToHuman('1.5', 6)).toThrow(ValidateNormalizerError)
  })
})

describe('scaleHumanToRaw (inverse round-trip)', () => {
  it('round-trips the CACAO case', () => {
    expect(scaleHumanToRaw('22.0208030381', 10)).toBe(220208030381n)
  })

  it('round-trips through scaleRawToHuman for assorted values', () => {
    for (const [raw, dec] of [
      ['1000000', 6],
      ['123456789012345678901', 18],
      ['21000', 0],
    ] as const) {
      expect(scaleHumanToRaw(scaleRawToHuman(raw, dec), dec)).toBe(BigInt(raw))
    }
  })

  it('expands scientific notation losslessly when exact', () => {
    expect(scaleHumanToRaw('1e-6', 6)).toBe(1n)
    expect(scaleHumanToRaw('1.5e0', 6)).toBe(1_500_000n)
  })

  // Fund-safety: `parseUnits` silently ROUNDS sub-`decimals` precision
  // (`'1.9999999' @6 -> 2000000`, `'0.0000000000000000001' @18 -> 0`). A
  // grounding/validator converter must NOT fabricate that — it must fail
  // closed so a claimed amount can never be silently rounded up a whole unit
  // or have a non-zero sub-unit dropped to zero.
  it('rejects sub-base-unit over-precision instead of rounding (fail-closed)', () => {
    expect(() => scaleHumanToRaw('1.9999999', 6)).toThrow(ValidateNormalizerError) // would round UP to 2.0
    expect(() => scaleHumanToRaw('0.1234567890123456789', 18)).toThrow(ValidateNormalizerError) // 19th digit
    expect(() => scaleHumanToRaw('0.0000000000000000001', 18)).toThrow(ValidateNormalizerError) // dropped to 0
    expect(() => scaleHumanToRaw('1.234567e0', 6)).not.toThrow() // exactly 6 dp via sci notation is fine
    expect(() => scaleHumanToRaw('1.2345678e0', 6)).toThrow(ValidateNormalizerError) // 7 dp via sci notation
  })
})

describe('amountMatches', () => {
  it('matches within tolerance and rejects mis-scaled (off by 1e5)', () => {
    expect(amountMatches('22.02', '22.0208030381', 0.01)).toBe(true)
    expect(amountMatches('0.000220208030381', '22.0208030381', 0.01)).toBe(false)
  })

  it('exact match at tolerance 0', () => {
    expect(amountMatches('1.5', '1.5', 0)).toBe(true)
    expect(amountMatches('1.5000000001', '1.5', 0)).toBe(false)
  })

  it('applies the 1e-18 absolute floor for tiny/zero expected', () => {
    expect(amountMatches('0', '0', 0.01)).toBe(true)
  })

  it('rejects a negative tolerance', () => {
    expect(() => amountMatches('1', '1', -0.1)).toThrow(ValidateNormalizerError)
  })
})

describe('computeEvmFee / feeMatches', () => {
  it('computes gasLimit * maxFeePerGas / 1e18', () => {
    // 21000 gas * 15 gwei = 315000 gwei = 0.000315 ETH
    expect(computeEvmFee(21000n, 15_000_000_000n)).toBe('0.000315')
  })

  it('handles >64-bit products without overflow', () => {
    // 500000 * 99999999999999999999 = 49999999999999999999500000 wei / 1e18
    expect(computeEvmFee('500000', '99999999999999999999')).toBe('49999999.9999999999995')
  })

  it('grounds a claimed fee within 5% and rejects a fabricated one', () => {
    expect(feeMatches('0.000315', 21000n, 15_000_000_000n)).toBe(true)
    expect(feeMatches('0.01', 21000n, 15_000_000_000n)).toBe(false)
  })
})

describe('token-decimals registry', () => {
  it('looks up canonical decimals case-insensitively', () => {
    expect(decimalsFor('cacao')).toBe(10)
    expect(decimalsFor('USDC')).toBe(6)
    expect(decimalsFor('ETH')).toBe(18)
    expect(decimalsFor('  weth ')).toBe(18)
  })

  it('returns undefined for unknown tickers', () => {
    expect(decimalsFor('NOTATOKEN')).toBeUndefined()
  })

  it('exposes a frozen registry', () => {
    expect(Object.isFrozen(tokenDecimals)).toBe(true)
  })
})

describe('token-symbol FORMAT validation', () => {
  it('accepts plain / dotted / pair shapes', () => {
    for (const s of ['ETH', 'USDC.e', 'RUJI/RUNE', 'ETH/USDC']) {
      expect(isValidTokenSymbolFormat(s)).toBe(true)
    }
  })

  it('rejects malformed shapes', () => {
    for (const s of ['', 'E', '1INCH', 'TOO-LONG-TICKER-NAME!!', 'a b']) {
      expect(isValidTokenSymbolFormat(s)).toBe(false)
    }
  })

  // Drift fix: mirror the Go `symbolCandidateRe` shape EXACTLY —
  // `[A-Z][A-Z0-9]{2,9}` base/pair (3-10 chars, uppercase-only, letter-led).
  // The previous SDK regex was `[A-Za-z][A-Za-z0-9]{1,9}` which accepted
  // 2-char + lowercase tickers the backend extractor rejects.
  it('rejects 2-char tickers (min length 3, matching Go)', () => {
    // Go `[A-Z][A-Z0-9]{2,9}` requires >= 3 chars, so OP / ZK never match
    // symbolCandidateRe upstream — the SDK must agree.
    for (const s of ['OP', 'ZK', 'op', 'zk', 'A1']) {
      expect(isValidTokenSymbolFormat(s)).toBe(false)
    }
  })

  it('stays case-insensitive via pre-upper (lowercase + mixed still valid)', () => {
    for (const s of ['eth', 'usdc.e', 'ruji/rune', 'Eth/Usdc']) {
      expect(isValidTokenSymbolFormat(s)).toBe(true)
    }
  })

  it('accepts 3-char and 10-char bounds, rejects 11-char overflow', () => {
    expect(isValidTokenSymbolFormat('BTC')).toBe(true) // 3
    expect(isValidTokenSymbolFormat('ABCDEFGHIJ')).toBe(true) // 10
    expect(isValidTokenSymbolFormat('ABCDEFGHIJK')).toBe(false) // 11
  })

  it('rejects a 2-char leg inside a slash-pair', () => {
    // Each leg must independently satisfy the 3-char minimum.
    expect(isValidTokenSymbolFormat('RUNE/OP')).toBe(false)
    expect(isValidTokenSymbolFormat('OP/RUNE')).toBe(false)
  })

  it('throws when normalizing a now-too-short ticker', () => {
    expect(() => normalizeTokenSymbol('op')).toThrow(ValidateNormalizerError)
  })

  it('normalizes to uppercase and splits pairs', () => {
    expect(normalizeTokenSymbol('usdc.e')).toEqual({ symbol: 'USDC.E', parts: ['USDC.E'] })
    expect(normalizeTokenSymbol('ruji/rune')).toEqual({ symbol: 'RUJI/RUNE', parts: ['RUJI', 'RUNE'] })
  })

  it('throws on invalid symbol normalization', () => {
    expect(() => normalizeTokenSymbol('!!!')).toThrow(ValidateNormalizerError)
  })
})
