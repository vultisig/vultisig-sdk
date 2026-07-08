import { describe, expect, it } from 'vitest'

import { promptOutput } from './prompt'

describe('shared prompt module', () => {
  it('renders prompt UI to stderr, never stdout (the machine-output channel)', () => {
    // Regression guard: if this is ever flipped back to process.stdout (or the
    // default inquirer module), interactive prompt bytes would corrupt the JSON
    // channel for piped consumers — the exact bug this module exists to prevent.
    expect(promptOutput).toBe(process.stderr)
    expect(promptOutput).not.toBe(process.stdout)
  })
})
