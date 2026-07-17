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
  let originalUmask: number

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vsig-export-mode-'))
    // Force a permissive umask for the duration. Otherwise a developer/CI umask of
    // 0077 would mask the bug: a plain writeFile would land 0600 by accident and the
    // fresh-file assertion below would pass even with the fix reverted.
    originalUmask = process.umask(0o022)
  })

  afterEach(async () => {
    process.umask(originalUmask)
    await fs.rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
    resetOutput()
  })

  it('creates a new export 0600, not world-readable, even under a permissive umask', async () => {
    const outputPath = path.join(tmpDir, 'fresh.vult')

    await executeExport(makeCtx(), { outputPath, exportPassword: 'pw' })

    expect(await modeOf(outputPath)).toBe('600')
  })

  it('replaces a pre-existing world-readable file with an owner-only one', async () => {
    // The keyshare must never land in the pre-existing 0644 file: writeFile's `mode`
    // only applies when it CREATES the file, so writing in place would put shares in a
    // world-readable file and only tighten it afterwards. The export writes a fresh
    // 0600 temp file and renames over the target instead.
    const outputPath = path.join(tmpDir, 'stale.vult')
    await fs.writeFile(outputPath, 'old', { mode: 0o644 })
    expect(await modeOf(outputPath)).toBe('644')

    await executeExport(makeCtx(), { outputPath, exportPassword: 'pw' })

    expect(await modeOf(outputPath)).toBe('600')
    expect(await fs.readFile(outputPath, 'utf-8')).toBe('VULT-KEYSHARE-BYTES')
  })

  it('never writes the keyshare into the pre-existing world-readable inode', async () => {
    // Directly pins the TOCTOU the temp+rename closes: if the shares were written in
    // place and chmod'd after, the ORIGINAL inode would hold them at 0644 for a window.
    // After a rename the target is a different inode, and the old one never saw them.
    const outputPath = path.join(tmpDir, 'watched.vult')
    await fs.writeFile(outputPath, 'old', { mode: 0o644 })
    const inodeBefore = (await fs.stat(outputPath)).ino

    await executeExport(makeCtx(), { outputPath, exportPassword: 'pw' })

    expect((await fs.stat(outputPath)).ino).not.toBe(inodeBefore)
  })

  it('leaves no temp file behind', async () => {
    const outputPath = path.join(tmpDir, 'clean.vult')

    await executeExport(makeCtx(), { outputPath, exportPassword: 'pw' })

    expect(await fs.readdir(tmpDir)).toEqual(['clean.vult'])
  })

  it('still writes the keyshare content it was given', async () => {
    const outputPath = path.join(tmpDir, 'content.vult')

    await executeExport(makeCtx(), { outputPath, exportPassword: 'pw' })

    expect(await fs.readFile(outputPath, 'utf-8')).toBe('VULT-KEYSHARE-BYTES')
  })
})
