// Regression tests for the sign-time password gate in runPasswordGatedTool
// (abts-02 / sdkcli2-10 #3): headless `agent ask --yes` with VAULT_PASSWORD (the
// documented signing env var) must sign without a --password flag.
//
// The bug: the gate re-prompted for a password whenever the `--password` flag
// (config.password) was unset — ignoring that #899 already unlocked the vault
// (and seeded the executor's password) from the keyring/env chain at init. In
// ask mode requestPassword throws, so VAULT_PASSWORD-only signing hard-failed
// with PASSWORD_REQUIRED even though the secret was already in hand.
//
// The fix gates on NEED — an encrypted-but-still-locked vault with no executor
// password — and retries the same non-interactive chain (cache → keyring →
// VAULT_PASSWORDS/VAULT_PASSWORD) before ever prompting. The #682 confirmation
// gate is a separate chokepoint and must still fire before every sign; each
// success case below asserts requestConfirmation ran before body().
//
// The method is private; it's exercised via the prototype with a minimal `this`
// so no real vault / fs / network is touched (mirrors sessionConfirmGate.test).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearCachedPassword } from '../../core/password-manager'
import { AgentErrorCode } from '../agentErrors'
import { AgentSession } from '../session'
import type { RecentAction } from '../types'

// The OS-keyring branch of resolvePasswordNonInteractive. Default: no entry, so
// the chain resolves from env only (or returns null). Keeps the real
// password-manager chain in play without touching the machine keychain.
vi.mock('../../core/credential-store', () => ({
  getServerPassword: vi.fn(async () => null),
}))

type VaultStub = {
  isEncrypted: boolean
  isUnlocked: () => boolean
  id: string
  name: string
}

function makeUi(opts: { approve?: boolean; requestPassword: () => Promise<string> }) {
  const order: string[] = []
  const ui = {
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    requestConfirmation: vi.fn(async (_msg: string) => {
      order.push('confirm')
      return opts.approve ?? true
    }),
    requestPassword: vi.fn(opts.requestPassword),
  }
  return { ui, order }
}

// requestPassword that throws exactly as ask-mode's does (ask.ts) — a headless
// one-shot has no interactive prompt.
const askModeRequestPassword = async (): Promise<string> => {
  throw new Error('Password required but not provided. Use --password flag.')
}

function callGate(opts: {
  toolName: string
  ui: ReturnType<typeof makeUi>['ui']
  order: string[]
  vault: VaultStub
  executorHasPassword: boolean
  config?: Record<string, unknown>
  pendingSummary?: string | null
  input?: Record<string, unknown>
}): {
  result: Promise<RecentAction>
  setPassword: ReturnType<typeof vi.fn>
  body: ReturnType<typeof vi.fn>
} {
  const setPassword = vi.fn()
  const body = vi.fn(async () => {
    opts.order.push('body')
    return { tool: opts.toolName, success: true, data: { tx_hash: '0xsigned' } } as RecentAction
  })
  const executor = {
    hasPassword: () => opts.executorHasPassword,
    setPassword,
    getPendingSummary: () => opts.pendingSummary ?? null,
    clearPendingTransaction: vi.fn(),
  }
  const fakeThis = {
    executor,
    vault: opts.vault,
    config: opts.config ?? { askMode: true },
  }
  const result = (AgentSession.prototype as any).runPasswordGatedTool.call(
    fakeThis,
    opts.toolName,
    'tc-1',
    opts.ui,
    body,
    opts.input
  )
  return { result, setPassword, body }
}

const lockedVault: VaultStub = {
  isEncrypted: true,
  isUnlocked: () => false,
  id: 'vault-id-1',
  name: 'Vultisig Cluster #1',
}

let prevVaultPassword: string | undefined
let prevVaultPasswords: string | undefined

beforeEach(() => {
  prevVaultPassword = process.env.VAULT_PASSWORD
  prevVaultPasswords = process.env.VAULT_PASSWORDS
  delete process.env.VAULT_PASSWORD
  delete process.env.VAULT_PASSWORDS
  // The in-memory password cache is module-level state — clear it so a value
  // resolved in one test can't leak into the next.
  clearCachedPassword()
})

afterEach(() => {
  if (prevVaultPassword === undefined) delete process.env.VAULT_PASSWORD
  else process.env.VAULT_PASSWORD = prevVaultPassword
  if (prevVaultPasswords === undefined) delete process.env.VAULT_PASSWORDS
  else process.env.VAULT_PASSWORDS = prevVaultPasswords
  clearCachedPassword()
})

describe('runPasswordGatedTool — sign gate keys off NEED, not --password', () => {
  // (a) The repro'd HIGH: ask-mode, no --password, executor already unlocked
  // from the env/keyring chain at init. The gate must NOT prompt (which would
  // throw) and must NOT fail PASSWORD_REQUIRED — it signs.
  it('ask-mode + executor already holds the password → no prompt, signs', async () => {
    const { ui, order } = makeUi({ requestPassword: askModeRequestPassword })
    // isUnlocked() deliberately false so the ONLY thing keeping the gate from
    // prompting is executor.hasPassword() — pins that branch specifically.
    const { result, setPassword, body } = callGate({
      toolName: 'sign_tx',
      ui,
      order,
      vault: lockedVault,
      executorHasPassword: true,
      pendingSummary: 'send 0.05 POL on Polygon to 0xd8dA',
    })
    const res = await result

    expect(ui.requestPassword).not.toHaveBeenCalled()
    expect(res.success).toBe(true)
    expect(res.data?.code).not.toBe(AgentErrorCode.PASSWORD_REQUIRED)
    expect(body).toHaveBeenCalledOnce()
    expect(setPassword).not.toHaveBeenCalled()
    // #682 confirmation gate still fires, and BEFORE signing.
    expect(ui.requestConfirmation).toHaveBeenCalledOnce()
    expect(order).toEqual(['confirm', 'body'])
  })

  // (b) Executor password was cleared mid-session and the vault re-locked, but
  // VAULT_PASSWORD is still exported. The gate resolves it silently via the
  // non-interactive chain — no prompt — and threads it into the executor.
  it('env-resolvable password + executor cleared → resolves silently, no prompt', async () => {
    process.env.VAULT_PASSWORD = 'env-secret'
    const { ui, order } = makeUi({ requestPassword: askModeRequestPassword })
    const { result, setPassword, body } = callGate({
      toolName: 'sign_tx',
      ui,
      order,
      vault: lockedVault,
      executorHasPassword: false,
      pendingSummary: 'send 0.05 POL on Polygon to 0xd8dA',
    })
    const res = await result

    expect(ui.requestPassword).not.toHaveBeenCalled()
    expect(setPassword).toHaveBeenCalledWith('env-secret')
    expect(res.success).toBe(true)
    expect(body).toHaveBeenCalledOnce()
    expect(order).toEqual(['confirm', 'body'])
  })

  // (c) Unencrypted vault: there is no password to have, so the gate must be
  // skipped entirely (isEncrypted false) and signing proceeds.
  it('unencrypted vault → gate skipped, no prompt, signs', async () => {
    const { ui, order } = makeUi({ requestPassword: askModeRequestPassword })
    const { result, setPassword, body } = callGate({
      toolName: 'sign_tx',
      ui,
      order,
      vault: { isEncrypted: false, isUnlocked: () => true, id: 'vault-id-1', name: 'Unencrypted' },
      executorHasPassword: false,
    })
    const res = await result

    expect(ui.requestPassword).not.toHaveBeenCalled()
    expect(setPassword).not.toHaveBeenCalled()
    expect(res.success).toBe(true)
    expect(body).toHaveBeenCalledOnce()
    expect(ui.requestConfirmation).toHaveBeenCalledOnce()
    expect(order).toEqual(['confirm', 'body'])
  })

  // (d) Locked vault, nothing resolvable, no flag: existing behavior preserved.
  // Ask mode (requestPassword throws) → PASSWORD_REQUIRED failure, body never
  // runs; the confirmation gate has already been cleared.
  it('locked vault + nothing resolvable + ask-mode → PASSWORD_REQUIRED preserved', async () => {
    const { ui, order } = makeUi({ requestPassword: askModeRequestPassword })
    const { result, setPassword, body } = callGate({
      toolName: 'sign_tx',
      ui,
      order,
      vault: lockedVault,
      executorHasPassword: false,
      pendingSummary: 'send 1 POL',
    })
    const res = await result

    expect(ui.requestPassword).toHaveBeenCalledOnce()
    expect(res.success).toBe(false)
    expect(res.data?.code).toBe(AgentErrorCode.PASSWORD_REQUIRED)
    expect(body).not.toHaveBeenCalled()
    expect(setPassword).not.toHaveBeenCalled()
    // Confirmation still ran (and was the only step before the password gate).
    expect(order).toEqual(['confirm'])
  })

  // (d, interactive variant) Locked vault, nothing resolvable, but an
  // interactive UI (TUI) whose requestPassword RESOLVES: the prompt still works
  // and its value threads into the executor, then signing proceeds.
  it('locked vault + nothing resolvable + interactive UI → prompts, then signs', async () => {
    const { ui, order } = makeUi({ requestPassword: async () => 'typed-secret' })
    const { result, setPassword, body } = callGate({
      toolName: 'sign_tx',
      ui,
      order,
      vault: lockedVault,
      executorHasPassword: false,
      config: { askMode: false },
      pendingSummary: 'send 1 POL',
    })
    const res = await result

    expect(ui.requestPassword).toHaveBeenCalledOnce()
    expect(setPassword).toHaveBeenCalledWith('typed-secret')
    expect(res.success).toBe(true)
    expect(body).toHaveBeenCalledOnce()
    expect(order).toEqual(['confirm', 'body'])
  })

  // (e) The --password flag path is unchanged: config.password short-circuits
  // the whole gate (the executor was seeded at construction), signing proceeds.
  it('--password (config.password) set → gate short-circuits, signs, no prompt', async () => {
    const { ui, order } = makeUi({ requestPassword: askModeRequestPassword })
    const { result, setPassword, body } = callGate({
      toolName: 'sign_tx',
      ui,
      order,
      vault: lockedVault,
      executorHasPassword: true,
      config: { askMode: true, password: 'flag-secret' },
      pendingSummary: 'send 1 POL',
    })
    const res = await result

    expect(ui.requestPassword).not.toHaveBeenCalled()
    expect(setPassword).not.toHaveBeenCalled()
    expect(res.success).toBe(true)
    expect(body).toHaveBeenCalledOnce()
    expect(ui.requestConfirmation).toHaveBeenCalledOnce()
    expect(order).toEqual(['confirm', 'body'])
  })
})
