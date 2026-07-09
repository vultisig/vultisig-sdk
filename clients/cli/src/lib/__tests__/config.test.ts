/**
 * VULTISIG_CONFIG_DIR storage wiring — regression for sdkcli2-07.
 *
 * The documented VULTISIG_CONFIG_DIR env var used to be a no-op for vault
 * storage: the CLI constructed `new Vultisig(...)` without a storage override,
 * so vaults/active-vault/cache always resolved to ~/.vultisig regardless of the
 * env var (only config.json + the agent journal honored it — a split-brain
 * config location). createVaultStorage() is the seam the CLI now uses to root
 * SDK vault storage at getConfigDir(); these tests pin that contract.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createVaultStorage, getConfigDir } from '../config'

describe('createVaultStorage (VULTISIG_CONFIG_DIR)', () => {
  const original = process.env.VULTISIG_CONFIG_DIR
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'vultisig-cfg-'))
  })

  afterEach(() => {
    if (original === undefined) {
      delete process.env.VULTISIG_CONFIG_DIR
    } else {
      process.env.VULTISIG_CONFIG_DIR = original
    }
    rmSync(tmp, { recursive: true, force: true })
  })

  it('roots vault storage at VULTISIG_CONFIG_DIR when set', () => {
    process.env.VULTISIG_CONFIG_DIR = tmp
    expect(getConfigDir()).toBe(tmp)
    expect(createVaultStorage().basePath).toBe(tmp)
  })

  it('falls back to ~/.vultisig when the env var is unset (unchanged default)', () => {
    delete process.env.VULTISIG_CONFIG_DIR
    const expected = join(homedir(), '.vultisig')
    expect(createVaultStorage().basePath).toBe(expected)
  })

  it('treats an empty/whitespace VULTISIG_CONFIG_DIR as unset (no mkdir("") failure)', () => {
    const expected = join(homedir(), '.vultisig')
    process.env.VULTISIG_CONFIG_DIR = ''
    expect(createVaultStorage().basePath).toBe(expected)
    process.env.VULTISIG_CONFIG_DIR = '   '
    expect(createVaultStorage().basePath).toBe(expected)
  })
})
