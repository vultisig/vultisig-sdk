import { afterEach, describe, expect, it } from 'vitest'

import { ConfirmationRequiredError, ExitCode } from '../core/errors'
import { isNonInteractive, requireInteractive, resetOutput, resolveNonInteractive, setNonInteractive } from './output'

afterEach(() => {
  resetOutput()
})

describe('resolveNonInteractive', () => {
  it('returns true when the explicit flag is set, regardless of stdout', () => {
    expect(resolveNonInteractive(true, { isTTY: true })).toBe(true)
    expect(resolveNonInteractive(true, { isTTY: false })).toBe(true)
  })

  it('stays interactive when stdout is a TTY and no flag is set', () => {
    expect(resolveNonInteractive(false, { isTTY: true })).toBe(false)
  })

  it('becomes non-interactive when stdout is piped/redirected (non-TTY)', () => {
    // A piped stdout is the machine-output channel — a prompt would corrupt it.
    expect(resolveNonInteractive(false, { isTTY: false })).toBe(true)
    expect(resolveNonInteractive(false, {})).toBe(true)
  })
})

describe('requireInteractive', () => {
  it('is a no-op in interactive mode', () => {
    setNonInteractive(false)
    expect(() => requireInteractive('use --yes')).not.toThrow()
  })

  it('fails closed with a stable ConfirmationRequiredError when non-interactive', () => {
    setNonInteractive(true)
    expect(isNonInteractive()).toBe(true)
    try {
      requireInteractive('Pass --yes to confirm.')
      throw new Error('expected requireInteractive to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfirmationRequiredError)
      const typed = err as ConfirmationRequiredError
      expect(typed.code).toBe('CONFIRMATION_REQUIRED')
      expect(typed.exitCode).toBe(ExitCode.CONFIRMATION_REQUIRED)
      // The hint is carried through so headless callers learn the escape hatch.
      expect(typed.hint).toBe('Pass --yes to confirm.')
    }
  })
})
