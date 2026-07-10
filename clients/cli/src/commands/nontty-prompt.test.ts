import type { VaultBase } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandContext } from '../core'
import { ConfirmationRequiredError } from '../core/errors'
import { resetOutput, setNonInteractive } from '../lib/output'
import { executeAddressBook } from './settings'
import { executeExport, executeImport, executeVerify } from './vault-management'

// Regression for PR #1034: the non-TTY fail-closed guard lives at the shared
// prompt chokepoint (src/lib/prompt.ts), so commands that never installed their
// own requireInteractive gate — import / export / verify / address-book — still
// fail closed in a headless session instead of rendering an inquirer prompt onto
// the machine-output channel. Each handler here reaches prompt() with no flag to
// satisfy the value; in non-interactive mode that must throw a typed
// ConfirmationRequiredError (exit 12) and write ZERO bytes to stdout.

// A ctx whose only reachable method before the prompt (executeExport's
// ensureActiveVault) resolves to a dummy vault. Every other member throws if
// touched — proving the guard fires before any real work.
function makeCtx(): CommandContext {
  const trap = () => {
    throw new Error('ctx accessed after the prompt guard should have fired')
  }
  return {
    get sdk(): never {
      return trap()
    },
    getActiveVault: trap,
    setActiveVault: trap,
    ensureActiveVault: async () => ({}) as VaultBase,
    getPassword: trap,
    cachePassword: trap,
    clearPasswordCache: trap,
    isPasswordCached: trap,
    isInteractive: false,
    dispose: () => {},
  } as unknown as CommandContext
}

let stdoutSpy: ReturnType<typeof vi.spyOn>
const savedEnv = { VAULT_PASSWORD: process.env.VAULT_PASSWORD, VULTISIG_PASSWORD: process.env.VULTISIG_PASSWORD }

beforeEach(() => {
  setNonInteractive(true)
  // No ambient password must satisfy the import/export prompts, or the guarded
  // path would be skipped and the test would prove nothing.
  delete process.env.VAULT_PASSWORD
  delete process.env.VULTISIG_PASSWORD
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
})

afterEach(() => {
  resetOutput()
  vi.restoreAllMocks()
  process.env.VAULT_PASSWORD = savedEnv.VAULT_PASSWORD
  process.env.VULTISIG_PASSWORD = savedEnv.VULTISIG_PASSWORD
  if (savedEnv.VAULT_PASSWORD === undefined) delete process.env.VAULT_PASSWORD
  if (savedEnv.VULTISIG_PASSWORD === undefined) delete process.env.VULTISIG_PASSWORD
})

async function expectFailsClosed(run: () => Promise<unknown>): Promise<void> {
  await expect(run()).rejects.toBeInstanceOf(ConfirmationRequiredError)
  try {
    await run()
  } catch (err) {
    const typed = err as ConfirmationRequiredError
    expect(typed.code).toBe('CONFIRMATION_REQUIRED')
    expect(typed.exitCode).toBe(12)
  }
  expect(stdoutSpy).not.toHaveBeenCalled()
}

describe('non-interactive prompt fail-closed, per command', () => {
  it('import (encrypted vault password prompt)', async () => {
    await expectFailsClosed(() => executeImport(makeCtx(), '/tmp/does-not-matter.vult'))
  })

  it('export (export-password prompt)', async () => {
    await expectFailsClosed(() => executeExport(makeCtx(), {}))
  })

  it('verify (OTP code prompt)', async () => {
    await expectFailsClosed(() => executeVerify(makeCtx(), 'vault-id', {}))
  })

  it('address-book --add (chain/address/name prompts)', async () => {
    await expectFailsClosed(() => executeAddressBook(makeCtx(), { add: true }))
  })
})
