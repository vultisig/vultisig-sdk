// Password-resolution wiring for the agent surface (audit fix-05).
//
// `agent ask` (and every agent mode) must resolve the vault password from the
// keyring/env chain BEFORE falling back to an interactive prompt, so a headless
// operator who configured the OS keyring or VAULT_PASSWORD never has to pass a
// funds-controlling secret on argv. Argv `--password` still works but is
// de-emphasized: it lands the secret in `ps`/shell history, so its use warns.
//
// Drives AgentSession.initialize through the prototype with a minimal `this`
// (no real vault/network), mocking authenticateVault + the context builders +
// the keyring branch, and exercising the REAL password-manager chain.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cachePassword,
  clearCachedPassword,
  getCachedPassword,
  getPassword,
  resolvePasswordNonInteractive,
} from '../../core/password-manager'
import { resetOutput, setSilentMode } from '../../lib/output'
import { authenticateVault } from '../auth'
import { AgentSession } from '../session'

vi.mock('../auth', () => ({
  authenticateVault: vi.fn(async () => ({ token: 'tok', expiresAt: 9_999_999_999, refreshToken: 'rt' })),
}))

vi.mock('../context', () => ({
  buildMinimalContext: vi.fn(async () => ({ addresses: {} })),
  buildMessageContext: vi.fn(async () => ({ addresses: {} })),
}))

// The keyring branch of the chain. Default: no keyring entry (returns null);
// individual tests override per-case.
vi.mock('../../core/credential-store', () => ({
  getServerPassword: vi.fn(async () => null),
}))

import { getServerPassword } from '../../core/credential-store'

const initialize = (AgentSession.prototype as any).initialize

// Ask-mode UI: requestPassword THROWS (there is no interactive prompt in a
// headless one-shot). So if init falls through to the UI callback instead of
// resolving from the chain, the test fails loudly — which is exactly the bug.
function makeAskUi() {
  return {
    onError: vi.fn(),
    requestPassword: vi.fn(async () => {
      throw new Error('Password required but not provided. Use --password flag.')
    }),
    onNotification: undefined,
  } as any
}

function makeFakeThis(over: { config?: any; client?: any; vault?: any } = {}) {
  return {
    client: {
      healthCheck: vi.fn(async () => true),
      setAuthToken: vi.fn(),
      getConversation: vi.fn(),
      createConversation: vi.fn(async () => ({ id: 'conv-1' })),
      ...over.client,
    },
    vault: {
      isEncrypted: true,
      unlock: vi.fn(async () => {}),
      id: 'vault-id-1',
      name: 'My Vault',
      publicKeys: { ecdsa: 'pk' },
      ...over.vault,
    },
    config: { askMode: true, ...over.config },
    publicKey: 'pk',
    executor: { setPassword: vi.fn() },
    conversationId: null as string | null,
    historyMessages: [] as any[],
    cachedContext: null,
    pushService: null,
    withAuthRetry: (AgentSession.prototype as any).withAuthRetry,
  }
}

let prevConfigDir: string | undefined
let prevVaultPassword: string | undefined
let prevVaultPasswords: string | undefined
let stderrSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // Isolate the token cache so loadCachedToken/saveCachedToken never touch
  // ~/.vultisig, and force the no-cached-token path so authenticateVault runs.
  prevConfigDir = process.env.VULTISIG_CONFIG_DIR
  process.env.VULTISIG_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'vulti-pwchain-'))

  prevVaultPassword = process.env.VAULT_PASSWORD
  prevVaultPasswords = process.env.VAULT_PASSWORDS
  delete process.env.VAULT_PASSWORD
  delete process.env.VAULT_PASSWORDS

  // The in-memory password cache is module-level state — clear it so a value
  // resolved in one test can't leak into the next.
  clearCachedPassword()

  vi.mocked(authenticateVault).mockClear()
  vi.mocked(getServerPassword).mockClear()
  vi.mocked(getServerPassword).mockResolvedValue(null as any)

  stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
  stderrSpy.mockRestore()
  if (prevConfigDir === undefined) delete process.env.VULTISIG_CONFIG_DIR
  else process.env.VULTISIG_CONFIG_DIR = prevConfigDir
  if (prevVaultPassword === undefined) delete process.env.VAULT_PASSWORD
  else process.env.VAULT_PASSWORD = prevVaultPassword
  if (prevVaultPasswords === undefined) delete process.env.VAULT_PASSWORDS
  else process.env.VAULT_PASSWORDS = prevVaultPasswords
  clearCachedPassword()
})

describe('AgentSession.initialize — password resolution chain', () => {
  it('resolves VAULT_PASSWORD from env with no --password (does not throw the argv error)', async () => {
    process.env.VAULT_PASSWORD = 'env-secret'
    const ft = makeFakeThis() // no config.password
    const ui = makeAskUi()

    await expect(initialize.call(ft, ui)).resolves.toBeUndefined()

    // Unlocked with the env-resolved password — never fell through to the UI
    // callback that throws "Use --password flag".
    expect(ft.vault.unlock).toHaveBeenCalledWith('env-secret')
    expect(ft.executor.setPassword).toHaveBeenCalledWith('env-secret')
    expect(ui.requestPassword).not.toHaveBeenCalled()
  })

  it('resolves from the OS keyring with no --password', async () => {
    vi.mocked(getServerPassword).mockResolvedValue('keyring-secret' as any)
    const ft = makeFakeThis() // no config.password, no env
    const ui = makeAskUi()

    await expect(initialize.call(ft, ui)).resolves.toBeUndefined()

    expect(getServerPassword).toHaveBeenCalledWith('vault-id-1')
    expect(ft.vault.unlock).toHaveBeenCalledWith('keyring-secret')
    expect(ui.requestPassword).not.toHaveBeenCalled()
  })

  it('argv --password still unlocks but emits a stderr deprecation warning', async () => {
    const ft = makeFakeThis({ config: { askMode: true, password: 'argv-secret' } })
    const ui = makeAskUi()

    await expect(initialize.call(ft, ui)).resolves.toBeUndefined()

    expect(ft.vault.unlock).toHaveBeenCalledWith('argv-secret')
    expect(ui.requestPassword).not.toHaveBeenCalled()
    // A warning was written to stderr pointing at the keyring/env path.
    const warned = stderrSpy.mock.calls.map(c => String(c[0])).join('')
    expect(warned).toMatch(/--password/)
    expect(warned).toMatch(/keyring|VAULT_PASSWORD|env/i)
  })

  it('resolves a per-vault password from the VAULT_PASSWORDS map with no --password', async () => {
    // Map format is "key:password key:password" (whitespace-separated), keyed
    // by vault id or name — the path a multi-vault headless operator relies on.
    process.env.VAULT_PASSWORDS = 'other-vault:nope vault-id-1:map-secret'
    const ft = makeFakeThis()
    const ui = makeAskUi()

    await expect(initialize.call(ft, ui)).resolves.toBeUndefined()

    expect(ft.vault.unlock).toHaveBeenCalledWith('map-secret')
    expect(ui.requestPassword).not.toHaveBeenCalled()
  })

  it('falls through to env when the keyring lookup throws (keyring unavailable)', async () => {
    vi.mocked(getServerPassword).mockRejectedValue(new Error('keyring unavailable') as any)
    process.env.VAULT_PASSWORD = 'env-secret'
    const ft = makeFakeThis()
    const ui = makeAskUi()

    await expect(initialize.call(ft, ui)).resolves.toBeUndefined()

    expect(ft.vault.unlock).toHaveBeenCalledWith('env-secret')
    expect(ui.requestPassword).not.toHaveBeenCalled()
  })

  it('re-prompts and retries unlock when a stored (keyring) password is stale (interactive mode)', async () => {
    // A stale keyring entry must not strand an interactive session: the bad
    // value is cleared and the UI prompt supplies the right one.
    vi.mocked(getServerPassword).mockResolvedValue('stale-secret' as any)
    const unlock = vi.fn(async (pw: string) => {
      if (pw === 'stale-secret') throw new Error('invalid password')
    })
    const ft = makeFakeThis({ config: { askMode: false }, vault: { unlock } })
    const ui = {
      onError: vi.fn(),
      requestPassword: vi.fn(async () => 'good-secret'),
      onNotification: undefined,
    } as any

    await expect(initialize.call(ft, ui)).resolves.toBeUndefined()

    expect(unlock).toHaveBeenNthCalledWith(1, 'stale-secret')
    expect(ui.requestPassword).toHaveBeenCalledTimes(1)
    expect(unlock).toHaveBeenNthCalledWith(2, 'good-secret')
    expect(ft.executor.setPassword).toHaveBeenCalledWith('good-secret')
    // The winning password is cached (so a later in-process lookup doesn't
    // re-fetch the stale stored value), under both id and name.
    expect(getCachedPassword('vault-id-1')).toBe('good-secret')
    expect(getCachedPassword('vault-id-1', 'My Vault')).toBe('good-secret')
  })

  it('ask mode: a stale stored password is evicted and the error names the stored credential (not "use --password")', async () => {
    // ask mode has no interactive prompt, so re-prompting would misdirect a
    // headless operator. The stale value must be cleared and the error must
    // point at the stored credential, not at argv.
    vi.mocked(getServerPassword).mockResolvedValue('stale-secret' as any)
    const unlock = vi.fn(async () => {
      throw new Error('invalid password')
    })
    const ft = makeFakeThis({ config: { askMode: true }, vault: { unlock } })
    const ui = makeAskUi() // requestPassword throws "Use --password flag"

    await expect(initialize.call(ft, ui)).rejects.toThrow(/Stored vault password .* was rejected/i)
    // The stale value was actually evicted from the module cache (it was cached
    // by resolvePasswordNonInteractive, then cleared on the unlock failure).
    expect(getCachedPassword('vault-id-1')).toBeNull()
    expect(getCachedPassword('vault-id-1', 'My Vault')).toBeNull()
    // ask mode never re-prompts.
    expect(ui.requestPassword).not.toHaveBeenCalled()
    expect(unlock).toHaveBeenCalledTimes(1)
  })

  it('does NOT re-prompt when an argv --password is wrong (no silent retry of an explicit secret)', async () => {
    const unlock = vi.fn(async () => {
      throw new Error('invalid password')
    })
    const ft = makeFakeThis({ config: { askMode: false, password: 'argv-wrong' }, vault: { unlock } })
    const ui = {
      onError: vi.fn(),
      requestPassword: vi.fn(async () => 'good-secret'),
      onNotification: undefined,
    } as any

    await expect(initialize.call(ft, ui)).rejects.toThrow(/invalid password/)
    expect(ui.requestPassword).not.toHaveBeenCalled()
    expect(unlock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the UI prompt only when the chain resolves nothing', async () => {
    // Non-ask UI whose requestPassword RESOLVES (e.g. TUI/pipe). With no env,
    // no keyring, no argv, the chain returns null and init uses the UI prompt.
    const ft = makeFakeThis({ config: { askMode: false } })
    const ui = {
      onError: vi.fn(),
      requestPassword: vi.fn(async () => 'prompted-secret'),
      onNotification: undefined,
    } as any

    await expect(initialize.call(ft, ui)).resolves.toBeUndefined()

    expect(ui.requestPassword).toHaveBeenCalledTimes(1)
    expect(ft.vault.unlock).toHaveBeenCalledWith('prompted-secret')
  })
})

// Locks the password-manager refactor that splits the non-interactive chain
// (cache → keyring → env) out of getPassword into resolvePasswordNonInteractive.
describe('password-manager — non-interactive chain + getPassword delegation', () => {
  beforeEach(() => {
    clearCachedPassword()
    delete process.env.VAULT_PASSWORD
    delete process.env.VAULT_PASSWORDS
    vi.mocked(getServerPassword).mockReset()
    vi.mocked(getServerPassword).mockResolvedValue(null as any)
  })

  afterEach(() => {
    clearCachedPassword()
    resetOutput()
  })

  it('resolvePasswordNonInteractive honors precedence: cache short-circuits the keyring', async () => {
    cachePassword('vault-id-1', 'cached-secret')
    const got = await resolvePasswordNonInteractive('vault-id-1', 'My Vault')
    expect(got).toBe('cached-secret')
    // Step 1 returned — the keyring branch must never be consulted.
    expect(getServerPassword).not.toHaveBeenCalled()
  })

  it('resolvePasswordNonInteractive returns null when nothing is configured (never prompts)', async () => {
    const got = await resolvePasswordNonInteractive('vault-id-1', 'My Vault')
    expect(got).toBeNull()
  })

  it('getPassword still throws in silent/JSON mode when the chain is empty (no prompt)', async () => {
    setSilentMode(true)
    await expect(getPassword('vault-id-1', 'My Vault')).rejects.toThrow(/Password required but not provided/)
  })

  it('getPassword delegates to the chain and returns the env-resolved value', async () => {
    setSilentMode(true) // ensure no interactive prompt even if the chain were empty
    process.env.VAULT_PASSWORD = 'env-secret'
    await expect(getPassword('vault-id-1', 'My Vault')).resolves.toBe('env-secret')
  })
})
