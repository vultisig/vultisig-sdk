import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ExitCode } from '../core/errors'

const CLI_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.ts')

/**
 * Run the CLI in a child process with piped (non-TTY) stdio, feeding it an empty
 * stdin. This reproduces the exact "headless"/piped invocation that used to make
 * `completion --install` render an inquirer shell picker to stdout and then crash
 * with a raw ERR_USE_AFTER_CLOSE readline stack trace (P2-4).
 */
function runPiped(args: string[]) {
  // Strip any ambient shell-completion env so the invocation can't be diverted into
  // handleCompletion() (tabtab reads COMP_LINE/COMP_POINT/COMP_CWORD).
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' }
  delete env.COMP_LINE
  delete env.COMP_POINT
  delete env.COMP_CWORD
  return spawnSync(process.execPath, ['--import', 'tsx', CLI_ENTRY, ...args], {
    input: '',
    encoding: 'utf8',
    timeout: 120_000,
    env,
  })
}

describe('completion --install in a non-TTY session', () => {
  it('fails closed gracefully instead of prompting on stdout or crashing on readline', () => {
    const res = runPiped(['completion', '--install'])

    // Never crash with the raw readline stack trace.
    const combined = `${res.stdout}\n${res.stderr}`
    expect(combined).not.toContain('ERR_USE_AFTER_CLOSE')

    // No inquirer prompt bytes on stdout — stdout is the machine-output channel.
    expect(res.stdout).not.toMatch(/Which Shell/i)
    expect(res.stdout.trim()).toBe('')

    // Stable, non-zero exit and a clear message on stderr telling the user how to proceed.
    expect(res.status).toBe(ExitCode.CONFIRMATION_REQUIRED)
    expect(res.stderr).toMatch(/interactive terminal/i)
  }, 130_000)
})
