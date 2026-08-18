import { describe, expect, it } from 'vitest'

import {
  isValidKaminoRequestAmount,
  kaminoAmountApiString,
  kaminoShareAmount,
  kaminoShareAmountFromDecimalString,
  kaminoShareToTokenValue,
  kaminoTokenAmount,
  kaminoTokenAmountFromBaseUnitString,
  kaminoTokenToShareAmount,
  kaminoTokenToShareAmountRoundedUp,
} from './amount'
import { parseKaminoRate } from './rate'

const u64Max = 2n ** 64n - 1n

describe('kaminoAmountApiString', () => {
  it('renders human units without trailing zeros', () => {
    expect(kaminoAmountApiString(kaminoTokenAmount(10_000_000n, 6))).toBe('10')
    expect(kaminoAmountApiString(kaminoTokenAmount(10_500_000n, 6))).toBe('10.5')
    expect(kaminoAmountApiString(kaminoTokenAmount(500_000_000n, 9))).toBe('0.5')
    expect(kaminoAmountApiString(kaminoTokenAmount(100_000n, 6))).toBe('0.1')
    expect(kaminoAmountApiString(kaminoTokenAmount(1n, 9))).toBe('0.000000001')
    expect(kaminoAmountApiString(kaminoTokenAmount(0n, 6))).toBe('0')
  })

  it('renders zero decimals as a plain integer', () => {
    expect(kaminoAmountApiString(kaminoTokenAmount(42n, 0))).toBe('42')
  })
})

describe('kaminoTokenAmountFromBaseUnitString', () => {
  it('parses published vault minimums', () => {
    const minDeposit = kaminoTokenAmountFromBaseUnitString('100000', 6)
    expect(minDeposit && kaminoAmountApiString(minDeposit)).toBe('0.1')

    const minWithdraw = kaminoTokenAmountFromBaseUnitString('1000', 6)
    expect(minWithdraw && kaminoAmountApiString(minWithdraw)).toBe('0.001')
  })

  it('refuses non-integer strings', () => {
    expect(kaminoTokenAmountFromBaseUnitString('1.5', 6)).toBeUndefined()
    expect(kaminoTokenAmountFromBaseUnitString('', 6)).toBeUndefined()
    expect(kaminoTokenAmountFromBaseUnitString('1e5', 6)).toBeUndefined()
  })
})

describe('kaminoShareAmountFromDecimalString', () => {
  it('parses reported position shares exactly', () => {
    const shares = kaminoShareAmountFromDecimalString('517536.857982', 6)
    expect(shares?.baseUnits).toBe(517_536_857_982n)
    expect(shares && kaminoAmountApiString(shares)).toBe('517536.857982')
  })

  it('truncates digits past the mint scale toward zero', () => {
    const shares = kaminoShareAmountFromDecimalString('1.00000049999999', 6)
    expect(shares?.baseUnits).toBe(1_000_000n)
  })
})

describe('kaminoShareToTokenValue', () => {
  it('uses tokensPerShare, never the USD share price', () => {
    // A SOL vault: tokensPerShare 0.0010749299151180878396 (SOL per share) vs
    // sharePrice 0.079437779653781828774 (USD per share). Using the wrong one
    // overstates the position by ~74x.
    const tokensPerShare = parseKaminoRate('0.0010749299151180878396')!
    const oneShare = kaminoShareAmount(1_000_000n, 6)

    const tokens = kaminoShareToTokenValue({ shares: oneShare, tokensPerShare, tokenDecimals: 9 })
    expect(tokens && kaminoAmountApiString(tokens)).toBe('0.001074929')
  })
})

describe('kaminoTokenToShareAmount', () => {
  it('truncates so a withdraw can never exceed the balance', () => {
    // 1 USDC at a share rate above parity is less than 1 share. Rounding up
    // would ask for more shares than the amount is worth, and the API rewrites
    // an over-sized withdraw to u64::MAX — a full exit.
    const tokensPerShare = parseKaminoRate('1.0536041812651029025')!
    const oneUsdc = kaminoTokenAmount(1_000_000n, 6)

    const shares = kaminoTokenToShareAmount({ tokens: oneUsdc, tokensPerShare, shareDecimals: 6 })
    expect(shares && kaminoAmountApiString(shares)).toBe('0.949123')

    // Round-tripping back must never exceed what the user asked to withdraw.
    const backToTokens = kaminoShareToTokenValue({ shares: shares!, tokensPerShare, tokenDecimals: 6 })
    expect(backToTokens?.baseUnits).toBe(999_999n)
    expect(backToTokens!.baseUnits <= oneUsdc.baseUnits).toBe(true)
  })

  it('truncates exactly at a base-unit boundary', () => {
    // The case a rounding division could get wrong: an exact quotient of half
    // a base unit must floor to zero, never round up to one.
    const tokensPerShare = parseKaminoRate('2')!
    const oneBaseUnit = kaminoTokenAmount(1n, 6)

    const shares = kaminoTokenToShareAmount({ tokens: oneBaseUnit, tokensPerShare, shareDecimals: 6 })
    expect(shares?.baseUnits).toBe(0n)
  })

  it('honours differing share and token decimals', () => {
    // The (token 9, share 6) case: scaling with the wrong decimals here is a
    // 1000x error.
    const tokensPerShare = parseKaminoRate('0.0010749299151180878396')!
    const oneSol = kaminoTokenAmount(1_000_000_000n, 9)

    const shares = kaminoTokenToShareAmount({ tokens: oneSol, tokensPerShare, shareDecimals: 6 })
    expect(shares && kaminoAmountApiString(shares)).toBe('930.293208')
  })

  it('rounded-up variant rounds away from the user and only there', () => {
    const tokensPerShare = parseKaminoRate('2')!
    const oneBaseUnit = kaminoTokenAmount(1n, 6)

    const shares = kaminoTokenToShareAmountRoundedUp({ tokens: oneBaseUnit, tokensPerShare, shareDecimals: 6 })
    expect(shares?.baseUnits).toBe(1n)

    // An exact quotient must not gain a base unit from the rounding mode.
    const twoBaseUnits = kaminoTokenAmount(2n, 6)
    const exact = kaminoTokenToShareAmountRoundedUp({ tokens: twoBaseUnits, tokensPerShare, shareDecimals: 6 })
    expect(exact?.baseUnits).toBe(1n)
  })

  it('rejects a non-positive rate', () => {
    const tokens = kaminoTokenAmount(1_000_000n, 6)
    const shares = kaminoShareAmount(1_000_000n, 6)
    const zero = parseKaminoRate('0')!
    const negative = parseKaminoRate('-1')!

    expect(kaminoTokenToShareAmount({ tokens, tokensPerShare: zero, shareDecimals: 6 })).toBeUndefined()
    expect(kaminoShareToTokenValue({ shares, tokensPerShare: zero, tokenDecimals: 6 })).toBeUndefined()
    expect(kaminoTokenToShareAmount({ tokens, tokensPerShare: negative, shareDecimals: 6 })).toBeUndefined()
  })

  it('rejects implausible decimal scales', () => {
    const tokensPerShare = parseKaminoRate('1.5')!
    const tokens = kaminoTokenAmount(1_000_000n, 6)

    expect(kaminoTokenToShareAmount({ tokens, tokensPerShare, shareDecimals: 64 })).toBeUndefined()
    expect(kaminoTokenToShareAmount({ tokens, tokensPerShare, shareDecimals: -1 })).toBeUndefined()
    expect(
      kaminoTokenToShareAmount({ tokens: kaminoTokenAmount(1n, 99), tokensPerShare, shareDecimals: 6 })
    ).toBeUndefined()
  })
})

describe('isValidKaminoRequestAmount', () => {
  it('rejects what cannot be sent', () => {
    // Solana instruction arguments are u64; anything larger cannot be
    // expressed on-chain no matter what the API accepts.
    expect(isValidKaminoRequestAmount(kaminoTokenAmount(u64Max + 1n, 6))).toBe(false)
    expect(isValidKaminoRequestAmount(kaminoTokenAmount(u64Max, 6))).toBe(true)

    expect(isValidKaminoRequestAmount(kaminoTokenAmount(0n, 6))).toBe(false)
    expect(isValidKaminoRequestAmount(kaminoTokenAmount(-1n, 6))).toBe(false)
    expect(isValidKaminoRequestAmount(kaminoTokenAmount(1n, 64))).toBe(false)
    expect(isValidKaminoRequestAmount(kaminoTokenAmount(1n, 6))).toBe(true)
  })
})
