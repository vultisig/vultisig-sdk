// Conversation-auth robustness (audit fix-07 findings a/b/c).
//
// Drives AgentSession.initialize through the prototype with a minimal `this`
// (no real vault/network), mocking authenticateVault + the context builders.
// Locks:
//   (a) the FRESH-conversation path now clear→reauth→retries a 401 instead of
//       hard-throwing `Authentication failed`;
//   (b) a resume whose 401 survives the single retry (or any persistent error)
//       falls back to a new conversation instead of throwing uncaught;
//   (c) that fallback emits a typed, non-fatal SESSION_NOT_FOUND signal carrying
//       the new conversation id (silent context-loss is observable now).
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentErrorCode } from '../agentErrors'
import { authenticateVault } from '../auth'
import { AgentSession, isAuthError } from '../session'

vi.mock('../auth', () => ({
  authenticateVault: vi.fn(async () => ({ token: 'reauth-tok', expiresAt: 9_999_999_999, refreshToken: 'rt' })),
}))

vi.mock('../context', () => ({
  buildMinimalContext: vi.fn(async () => ({ addresses: {} })),
  buildMessageContext: vi.fn(async () => ({ addresses: {} })),
}))

const authError = () => new Error('Request failed (401): unauthorized')

function makeUi() {
  return {
    onError: vi.fn(),
    requestPassword: vi.fn(async () => 'pw'),
    onNotification: undefined,
  } as any
}

function makeFakeThis(over: { config?: any; client?: any } = {}) {
  return {
    client: {
      healthCheck: vi.fn(async () => true),
      setAuthToken: vi.fn(),
      getConversation: vi.fn(),
      createConversation: vi.fn(async () => ({ id: 'conv-default' })),
      ...over.client,
    },
    vault: { isEncrypted: false, publicKeys: { ecdsa: 'pk' } },
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

const initialize = (AgentSession.prototype as any).initialize

let prevConfigDir: string | undefined

beforeEach(() => {
  // Isolate the token cache so clear/saveCachedToken never touch ~/.vultisig.
  prevConfigDir = process.env.VULTISIG_CONFIG_DIR
  process.env.VULTISIG_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'vulti-auth-'))
  vi.mocked(authenticateVault).mockClear()
})

afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.VULTISIG_CONFIG_DIR
  else process.env.VULTISIG_CONFIG_DIR = prevConfigDir
})

describe('initialize — fresh-conversation path (finding a)', () => {
  it('clears, re-auths, and retries createConversation on a 401 — init does NOT throw', async () => {
    let calls = 0
    const createConversation = vi.fn(async () => {
      calls++
      if (calls === 1) throw authError()
      return { id: 'conv-fresh' }
    })
    const ft = makeFakeThis({ client: { createConversation } })
    const ui = makeUi()

    await expect(initialize.call(ft, ui)).resolves.toBeUndefined()

    expect(createConversation).toHaveBeenCalledTimes(2)
    expect(ft.conversationId).toBe('conv-fresh')
    // Re-auth ran (the 401 recovery) and the new token was installed.
    expect(authenticateVault).toHaveBeenCalled()
    expect(ft.client.setAuthToken).toHaveBeenCalledWith('reauth-tok')
    // Fresh path is not a resume — no session-not-found signal.
    expect(ui.onError).not.toHaveBeenCalled()
  })

  it('propagates a 401 that survives the single retry (recovery is bounded, not infinite)', async () => {
    const createConversation = vi.fn(async () => {
      throw authError()
    })
    const ft = makeFakeThis({ client: { createConversation } })

    await expect(initialize.call(ft, makeUi())).rejects.toThrow(/401/)
    expect(createConversation).toHaveBeenCalledTimes(2) // original + one retry
  })
})

describe('initialize — resume fallback + signal (findings b/c)', () => {
  it('falls back to a new conversation and emits SESSION_NOT_FOUND on a non-auth resume error', async () => {
    const getConversation = vi.fn(async () => {
      throw new Error('conversation not found')
    })
    const createConversation = vi.fn(async () => ({ id: 'conv-fallback' }))
    const ft = makeFakeThis({ config: { sessionId: 'stale-id' }, client: { getConversation, createConversation } })
    const ui = makeUi()

    await initialize.call(ft, ui)

    expect(getConversation).toHaveBeenCalledTimes(1) // non-auth → no inner retry
    expect(ft.conversationId).toBe('conv-fallback')
    expect(ui.onError).toHaveBeenCalledTimes(1)
    expect(ui.onError).toHaveBeenCalledWith(expect.stringContaining('conv-fallback'), AgentErrorCode.SESSION_NOT_FOUND)
  })

  it('falls back when a resume 401 survives the single retry, then signals SESSION_NOT_FOUND', async () => {
    const getConversation = vi.fn(async () => {
      throw authError()
    })
    const createConversation = vi.fn(async () => ({ id: 'conv-after-401' }))
    const ft = makeFakeThis({ config: { sessionId: 'stale-id' }, client: { getConversation, createConversation } })
    const ui = makeUi()

    await initialize.call(ft, ui)

    expect(getConversation).toHaveBeenCalledTimes(2) // original + one auth retry
    expect(authenticateVault).toHaveBeenCalled()
    expect(ft.conversationId).toBe('conv-after-401')
    expect(ui.onError).toHaveBeenCalledWith(
      expect.stringContaining('could not be resumed'),
      AgentErrorCode.SESSION_NOT_FOUND
    )
  })

  it('resumes cleanly when getConversation succeeds — no fallback, no signal', async () => {
    const getConversation = vi.fn(async () => ({
      messages: [{ id: 'm1', role: 'user', content: 'hi' }],
    }))
    const createConversation = vi.fn()
    const ft = makeFakeThis({ config: { sessionId: 'good-id' }, client: { getConversation, createConversation } })
    const ui = makeUi()

    await initialize.call(ft, ui)

    expect(ft.conversationId).toBe('good-id')
    expect(ft.historyMessages).toHaveLength(1)
    expect(createConversation).not.toHaveBeenCalled()
    expect(ui.onError).not.toHaveBeenCalled()
  })
})

describe('withAuthRetry / isAuthError', () => {
  it('isAuthError classifies 401/403 messages and ignores others', () => {
    expect(isAuthError(new Error('Request failed (401): nope'))).toBe(true)
    expect(isAuthError(new Error('Forbidden (403)'))).toBe(true)
    expect(isAuthError(new Error('500 server error'))).toBe(false)
    expect(isAuthError('plain string')).toBe(false)
  })

  it('rethrows a non-auth error without re-authenticating', async () => {
    const ft = makeFakeThis()
    const request = vi.fn(async () => {
      throw new Error('500 boom')
    })
    await expect((AgentSession.prototype as any).withAuthRetry.call(ft, request)).rejects.toThrow(/boom/)
    expect(request).toHaveBeenCalledTimes(1)
    expect(authenticateVault).not.toHaveBeenCalled()
  })
})
