import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmationRequiredError } from './core/errors'
import { resetOutput, setNonInteractive } from './lib/output'
import { confirmSwap, confirmTransaction, formatBalanceAmount, formatBigintAmount } from './ui'

afterEach(() => {
  resetOutput()
  vi.restoreAllMocks()
})

// The confirm prompts are the fund-safety gate. In a non-interactive session
// (piped/redirected stdout or stdin, or --non-interactive/--ci) they must fail closed with a stable
// CONFIRMATION_REQUIRED error BEFORE any inquirer prompt is drawn. The stdout-spy
// assertion documents that the throw happens ahead of any render; stderr-vs-stdout
// routing of the prompt UI itself is covered in prompt.test.ts.
describe('confirm prompts fail closed in non-interactive mode', () => {
  it('confirmTransaction rejects with ConfirmationRequiredError and never writes to stdout', async () => {
    setNonInteractive(true)
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    await expect(confirmTransaction()).rejects.toBeInstanceOf(ConfirmationRequiredError)
    expect(stdoutSpy).not.toHaveBeenCalled()
  })

  it('confirmSwap rejects with ConfirmationRequiredError and never writes to stdout', async () => {
    setNonInteractive(true)
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    await expect(confirmSwap()).rejects.toBeInstanceOf(ConfirmationRequiredError)
    expect(stdoutSpy).not.toHaveBeenCalled()
  })
})

// formatBigintAmount delegates to the SDK's pure-bigint fromChainAmountExact.
// The old hand-rolled divisor was `BigInt(10 ** decimals)`, a float64 power
// exact only up to decimals=22 — past that it silently corrupted output.
describe('formatBigintAmount', () => {
  it('formats standard decimals (6/8/18) with hand-computed values', () => {
    expect(formatBigintAmount(1500000n, 6)).toBe('1.5')
    expect(formatBigintAmount(30558n, 8)).toBe('0.00030558')
    expect(formatBigintAmount(1500000000000000000n, 18)).toBe('1.5')
  })

  it('returns "0" for a zero amount', () => {
    expect(formatBigintAmount(0n, 18)).toBe('0')
  })

  it('trims trailing fraction zeros and drops the fraction entirely for whole numbers', () => {
    expect(formatBigintAmount(1000000n, 6)).toBe('1')
    expect(formatBigintAmount(1100000n, 6)).toBe('1.1')
  })

  it('formats a dust (fraction-only) amount', () => {
    expect(formatBigintAmount(1n, 18)).toBe('0.000000000000000001')
  })

  it('is exact at decimals=24, where the old float divisor drifted', () => {
    expect(formatBigintAmount(1234567890123456789012345n, 24)).toBe('1.234567890123456789012345')
    // Old `BigInt(10 ** 24)` divisor was 999999999999999983222784 (should be
    // 10^24 exactly) — the corrupted output would have been
    // '1.234567890123456805789561'.
  })

  it('is exact at decimals=30, where the old float divisor drifted across whole+fraction', () => {
    expect(formatBigintAmount(5123456789012345678901234567890n, 30)).toBe('5.12345678901234567890123456789')
    // Old `BigInt(10 ** 30)` divisor was 1000000000000000019884624838656
    // (should be 10^30 exactly) — the corrupted output would have been
    // '5.12345678901234557947811037461'.
  })
})

describe('formatBalanceAmount', () => {
  it('formats a raw string amount, delegating to formatBigintAmount', () => {
    expect(formatBalanceAmount('1234567', 6)).toBe('1.234567')
  })

  it('returns "0" for a zero/empty amount without throwing', () => {
    expect(formatBalanceAmount('0', 18)).toBe('0')
    expect(formatBalanceAmount('', 18)).toBe('0')
  })

  it('falls back to the raw string on a non-integer amount instead of throwing', () => {
    expect(formatBalanceAmount('not-a-number', 18)).toBe('not-a-number')
  })
})
