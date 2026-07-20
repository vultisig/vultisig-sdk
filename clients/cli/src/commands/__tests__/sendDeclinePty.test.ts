/**
 * F1: an interactive `send` decline must exit 12 CONFIRMATION_REQUIRED, never the
 * old swallowed exit 0. This drives the fixture inside a REAL pseudo-terminal
 * (node-pty) so process.stdin/stdout are TTYs and inquirer's confirm actually
 * renders; we answer "n" once the prompt appears and assert the child's real exit
 * code (from node-pty's onExit). Deterministic: the confirm default is also false,
 * so the decline (→ exit 12) is the only reachable outcome.
 */
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as pty from 'node-pty'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { ExitCode } from '../../core/errors'

const FIXTURE = fileURLToPath(new URL('./fixtures/sendDeclineProcess.ts', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../../../..', import.meta.url))

// yarn's prebuild unpack strips the executable bit off node-pty's `spawn-helper`,
// so posix_spawnp fails at pty.spawn. Restore +x on this platform's prebuild
// before spawning — cross-platform and idempotent (a no-op where it's absent).
beforeAll(() => {
  try {
    const req = createRequire(import.meta.url)
    const root = dirname(req.resolve('node-pty/package.json'))
    chmodSync(join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'), 0o755)
  } catch {
    // Windows (conpty, no helper) or a layout without prebuilds — nothing to fix.
  }
})

let dir: string
let prevConfigDir: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vsig-decline-pty-'))
  prevConfigDir = process.env.VULTISIG_CONFIG_DIR
})

afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.VULTISIG_CONFIG_DIR
  else process.env.VULTISIG_CONFIG_DIR = prevConfigDir
  rmSync(dir, { recursive: true, force: true })
})

/**
 * Run the fixture under a pty, answer "n" at the confirm prompt, and resolve with
 * the child's exit code and the combined pty output (stdout+stderr share the pty).
 */
function runUnderPty(mode: 'table' | 'json'): Promise<{ code: number; output: string }> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NO_COLOR: '1',
    VULTISIG_CONFIG_DIR: dir,
  }
  delete env.COMP_LINE
  delete env.COMP_POINT
  delete env.COMP_CWORD

  const child = pty.spawn(process.execPath, ['--import', 'tsx', FIXTURE, join(dir, 'exit-code'), mode], {
    name: 'xterm-color',
    cols: 100,
    rows: 30,
    cwd: REPO_ROOT,
    env,
  })

  let output = ''
  let answered = false
  const answer = () => {
    if (answered) return
    answered = true
    child.write('n\r')
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`pty timed out; output so far:\n${output}`))
    }, 60_000)

    child.onData(d => {
      output += d
      // Answer "no" once the confirm prompt has rendered.
      if (/Proceed with this transaction\?/i.test(output)) answer()
    })
    child.onExit(({ exitCode }) => {
      clearTimeout(timer)
      resolve({ code: exitCode, output })
    })
  })
}

describe('interactive send decline (PTY-driven)', () => {
  it('table mode: answering "no" at the confirm prompt exits 12 CONFIRMATION_REQUIRED', async () => {
    const { code } = await runUnderPty('table')
    expect(code).toBe(ExitCode.CONFIRMATION_REQUIRED)
  }, 70_000)

  it('json mode: the decline emits a success:false CONFIRMATION_REQUIRED envelope and exits 12', async () => {
    const { code, output } = await runUnderPty('json')
    expect(code).toBe(ExitCode.CONFIRMATION_REQUIRED)
    expect(output).toContain('"success": false')
    expect(output).toContain('CONFIRMATION_REQUIRED')
  }, 70_000)
})
