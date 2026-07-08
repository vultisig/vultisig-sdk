import { afterEach, describe, expect, it } from 'vitest'

import { ConfirmationRequiredError, ExitCode } from '../core/errors'
import { isNonInteractive, requireInteractive, resetOutput, resolveNonInteractive, setNonInteractive } from './output'

afterEach(() => {
  resetOutput()
})

describe('resolveNonInteractive', () => {
  const tty = { isTTY: true }
  const piped = { isTTY: false }

  it('returns true when the explicit flag is set, regardless of streams', () => {
    expect(resolveNonInteractive(true, tty, tty)).toBe(true)
    expect(resolveNonInteractive(true, piped, piped)).toBe(true)
  })

  it('stays interactive only when BOTH stdout and stdin are TTYs and no flag is set', () => {
    expect(resolveNonInteractive(false, tty, tty)).toBe(false)
  })

  it('becomes non-interactive when stdout is piped/redirected (machine-output channel)', () => {
    expect(resolveNonInteractive(false, piped, tty)).toBe(true)
    expect(resolveNonInteractive(false, {}, tty)).toBe(true)
  })

  it('becomes non-interactive when stdin is piped/redirected (no human to answer)', () => {
    // A piped stdin would otherwise let inquirer consume bytes as answers — a piped
    // `y` silently confirming a send. Fail closed instead.
    expect(resolveNonInteractive(false, tty, piped)).toBe(true)
    expect(resolveNonInteractive(false, tty, {})).toBe(true)
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
