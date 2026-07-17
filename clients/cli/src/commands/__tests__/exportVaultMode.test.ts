// `export` writes the keyshare file owner-only (vultisig-sdk sdkcli2-13 P1-7 / P4-4).
//
// Regression guard: the export used to be written with the default umask (0644 —
// world-readable) into the cwd, including $HOME, even though the SDK's own vault
// store is 0600. `auth setup` then auto-discovers that file as a credential anchor.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetOutput } from '../../lib/output'
import { executeExport } from '../vault-management'

function makeCtx() {
  const vault = {
    export: vi.fn(async () => ({ data: 'VULT-KEYSHARE-BYTES', filename: 'test-vault.vult' })),
  }
  return { ensureActiveVault: vi.fn(async () => vault) } as never
}

async function modeOf(file: string): Promise<string> {
  const stat = await fs.stat(file)
  return (stat.mode & 0o777).toString(8)
}

describe('export file permissions', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vsig-export-mode-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
    resetOutput()
  })

  it('creates a new export 0600, not world-readable', async () => {
    const outputPath = path.join(tmpDir, 'fresh.vult')

    await executeExport(makeCtx(), { outputPath, exportPassword: 'pw' })

    expect(await modeOf(outputPath)).toBe('600')
  })

  it('tightens the mode when overwriting a pre-existing world-readable file', async () => {
    // `mode` in writeFile only applies at creation, so an existing 0644 file would
    // keep its mode and silently leak the new keyshare.
    const outputPath = path.join(tmpDir, 'stale.vult')
    await fs.writeFile(outputPath, 'old', { mode: 0o644 })
    expect(await modeOf(outputPath)).toBe('644')

    await executeExport(makeCtx(), { outputPath, exportPassword: 'pw' })

    expect(await modeOf(outputPath)).toBe('600')
  })

  it('still writes the keyshare content it was given', async () => {
    const outputPath = path.join(tmpDir, 'content.vult')

    await executeExport(makeCtx(), { outputPath, exportPassword: 'pw' })

    expect(await fs.readFile(outputPath, 'utf-8')).toBe('VULT-KEYSHARE-BYTES')
  })
})
