import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path, { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ExitCode } from '../core/errors'

const parseEnvMock = vi.fn()
const logMock = vi.fn()

vi.mock('tabtab', () => ({
  default: {
    parseEnv: parseEnvMock,
    log: logMock,
  },
}))

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

describe('handleCompletion vault completion', () => {
  const originalConfigDir = process.env.VULTISIG_CONFIG_DIR
  let tmpConfigDir: string

  beforeEach(() => {
    vi.resetModules()
    parseEnvMock.mockReset()
    logMock.mockReset()
    tmpConfigDir = mkdtempSync(join(tmpdir(), 'vultisig-completion-'))
  })

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.VULTISIG_CONFIG_DIR
    } else {
      process.env.VULTISIG_CONFIG_DIR = originalConfigDir
    }
    rmSync(tmpConfigDir, { recursive: true, force: true })
  })

  it('reads vault names from the SDK storage layout rooted at VULTISIG_CONFIG_DIR', async () => {
    process.env.VULTISIG_CONFIG_DIR = tmpConfigDir
    writeFileSync(
      join(tmpConfigDir, 'vault:alpha-id.json'),
      JSON.stringify({
        value: { id: 'alpha-id', name: 'Alpha Vault' },
        metadata: { version: 1, createdAt: 1, lastModified: 1 },
      })
    )
    parseEnvMock.mockReturnValue({
      complete: true,
      line: 'vultisig switch A',
      lastPartial: 'A',
    })

    const { handleCompletion } = await import('./completion')

    await expect(handleCompletion()).resolves.toBe(true)
    expect(logMock).toHaveBeenCalledWith(['Alpha Vault', 'alpha-id'])
  })
})

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
