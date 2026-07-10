import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmationRequiredError } from '../core/errors'
import { resetOutput, setNonInteractive } from './output'
import { prompt, promptOutput } from './prompt'

afterEach(() => {
  resetOutput()
  vi.restoreAllMocks()
})

describe('shared prompt module', () => {
  it('renders prompt UI to stderr, never stdout (the machine-output channel)', () => {
    // Regression guard: if this is ever flipped back to process.stdout (or the
    // default inquirer module), interactive prompt bytes would corrupt the JSON
    // channel for piped consumers — the exact bug this module exists to prevent.
    expect(promptOutput).toBe(process.stderr)
    expect(promptOutput).not.toBe(process.stdout)
  })
})

// The chokepoint guard: EVERY prompt() caller (current + future) must fail closed
// in a non-interactive session before inquirer renders. Previously each command
// had to remember to call requireInteractive itself, so commands like
// import/export/verify/address-book still reached the raw prompt in headless runs.
describe('prompt() fails closed at the chokepoint in non-interactive mode', () => {
  // Every real caller `await`s prompt() inside an async function, so the guard's
  // throw surfaces as a rejection there. Mirror that by driving it through an
  // async thunk (the same shape ui.test.ts uses via confirmTransaction).
  it('throws ConfirmationRequiredError (exit 12) and writes ZERO bytes to stdout', async () => {
    setNonInteractive(true)
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

    let caught: unknown
    try {
      await (async () => prompt([{ type: 'input', name: 'code', message: 'Enter code:' }]))()
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ConfirmationRequiredError)
    expect((caught as ConfirmationRequiredError).code).toBe('CONFIRMATION_REQUIRED')
    expect((caught as ConfirmationRequiredError).exitCode).toBe(12)
    expect(stdoutSpy).not.toHaveBeenCalled()
  })

  it('points a password prompt at the credential flags', async () => {
    setNonInteractive(true)
    let caught: unknown
    try {
      await (async () => prompt([{ type: 'password', name: 'password', message: 'Enter password:' }]))()
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ConfirmationRequiredError)
    const hint = (caught as ConfirmationRequiredError).hint ?? ''
    expect(hint).toContain('--password')
    expect(hint).toContain('VAULT_PASSWORD')
  })

  it('accepts a single (non-array) question object and still fails closed', async () => {
    setNonInteractive(true)
    let caught: unknown
    try {
      await (async () =>
        prompt({ type: 'input', name: 'x', message: 'x?' } as unknown as Parameters<typeof prompt>[0]))()
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ConfirmationRequiredError)
  })
})
