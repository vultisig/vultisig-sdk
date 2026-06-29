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
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
    // initialize delegates the encrypted-vault unlock to this private method;
    // bind it so the prototype-driven call resolves (vault here is unencrypted,
    // so it early-returns).
    unlockEncryptedVault: (AgentSession.prototype as any).unlockEncryptedVault,
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

describe('recoverDisconnectedTurn — revoked token during the recovery poll (finding M1)', () => {
  // The SSE-disconnect recovery poll must self-heal a token revoked mid-recovery
  // (revoked-but-unexpired, inside the ~3-min window). Before the fix the poll
  // called client.messagesSince directly, so a 401 fell into the generic
  // sleep/continue loop and spun through every poll — silently losing the
  // assistant reply / tx_ready. The poll now routes through withAuthRetry like
  // every other conversation request.
  //
  // The mock throws 401 while the client token is the revoked one and only
  // succeeds once re-auth installs 'reauth-tok'. So WITHOUT the wrap there is no
  // re-auth, the token never changes, and every poll throws → recovery exhausts
  // with message===null and authenticateVault never called (the red state).
  function makeRecoveryThis(messagesSince: any, client: any) {
    return {
      conversationId: 'conv-1',
      publicKey: 'pk',
      vault: { isEncrypted: false, publicKeys: { ecdsa: 'pk' } },
      config: { verbose: false },
      recoveryMaxPolls: 4,
      recoveryPollIntervalMs: 0,
      client: { messagesSince, ...client },
      withAuthRetry: (AgentSession.prototype as any).withAuthRetry,
      recoverySleep: (AgentSession.prototype as any).recoverySleep,
      applyRecoveredMessage: (AgentSession.prototype as any).applyRecoveredMessage,
    }
  }

  it('re-auths + retries the poll on a revoked token instead of spinning to timeout', async () => {
    let token = 'revoked'
    const setAuthToken = vi.fn((t: string) => {
      token = t
    })
    const recovered = {
      id: 'm-recovered',
      role: 'assistant',
      content: 'Here is your balance: 1.5 ETH',
    }
    const messagesSince = vi.fn(async () => {
      if (token !== 'reauth-tok') throw authError()
      return { messages: [recovered], cursor: 'c' }
    })

    const streamResult: any = { message: null, transactions: [], serverNow: '1718870400000' }
    const ft = makeRecoveryThis(messagesSince, { setAuthToken })

    await (AgentSession.prototype as any).recoverDisconnectedTurn.call(ft, streamResult, undefined)

    // Self-healed: the revoked token was cleared, re-auth ran once, the new token
    // was installed, and the retried poll recovered the lost answer.
    expect(authenticateVault).toHaveBeenCalledTimes(1)
    expect(setAuthToken).toHaveBeenCalledWith('reauth-tok')
    expect(streamResult.message?.content).toBe('Here is your balance: 1.5 ETH')
    // Two messagesSince calls within a SINGLE poll attempt: the 401 + the retry.
    expect(messagesSince).toHaveBeenCalledTimes(2)
  })

  it('re-auths at most ONCE across a persistent auth failure (no per-poll MPC re-sign storm)', async () => {
    // Codex M1-followup: re-auth is a full MPC re-sign, so the recovery loop must
    // not re-sign on every poll when a 401 persists after the first re-auth. The
    // first auth-failing poll spends the single re-auth; later polls hit
    // messagesSince directly with the refreshed token, so authenticateVault fires
    // exactly once regardless of recoveryMaxPolls — bounded, never a re-sign storm.
    const setAuthToken = vi.fn() // never makes the token valid → 401 persists
    const messagesSince = vi.fn(async () => {
      throw authError()
    })
    const streamResult: any = { message: null, transactions: [], serverNow: '1718870400000' }
    const ft = makeRecoveryThis(messagesSince, { setAuthToken })

    await (AgentSession.prototype as any).recoverDisconnectedTurn.call(ft, streamResult, undefined)

    expect(streamResult.message).toBeNull() // bounded give-up, not a hang
    // Exactly ONE re-auth for the whole recovery window — not one per poll.
    expect(authenticateVault).toHaveBeenCalledTimes(1)
    // poll 0: messagesSince ×2 (original + the single withAuthRetry retry);
    // polls 1-3: messagesSince ×1 each (direct, no further re-auth) = 5 total.
    expect(messagesSince).toHaveBeenCalledTimes(5)
  })

  it('re-auths only ONCE even when the re-auth itself throws (MPC re-sign failure)', async () => {
    // Codex M1-followup edge: the single re-auth must be "spent" the instant it is
    // committed to — BEFORE authenticateVault runs — so a re-auth that throws a
    // NON-auth error (MPC re-sign failure, auth endpoint down) cannot let the next
    // poll re-enter withAuthRetry and re-sign again. Flipping the flag only in the
    // catch (on the final error type) would miss this case and re-sign every poll.
    vi.mocked(authenticateVault).mockImplementationOnce(async () => {
      throw new Error('mpc re-sign failed') // non-auth error from the re-sign itself
    })
    const messagesSince = vi.fn(async () => {
      throw authError() // token stays revoked for the whole window
    })
    const streamResult: any = { message: null, transactions: [], serverNow: '1718870400000' }
    const ft = makeRecoveryThis(messagesSince, { setAuthToken: vi.fn() })

    await (AgentSession.prototype as any).recoverDisconnectedTurn.call(ft, streamResult, undefined)

    expect(streamResult.message).toBeNull()
    // Re-auth committed (and threw) on poll 0; polls 1-3 poll directly → never
    // a second authenticateVault, regardless of the re-sign failure.
    expect(authenticateVault).toHaveBeenCalledTimes(1)
    // poll 0: messagesSince ×1 (the 401 that triggers re-auth; the retry never
    // runs because authenticateVault threw first); polls 1-3: ×1 each = 4 total.
    expect(messagesSince).toHaveBeenCalledTimes(4)
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

  it('preserves a previously cached refreshToken when re-auth returns none (CodeRabbit Major)', async () => {
    // withAuthRetry clears the whole cache entry before re-authenticating. If the
    // MPC re-sign comes back WITHOUT a refreshToken, the prior one must survive —
    // the clear-before-save must not strand it. Red before capture-before-clear.
    const storePath = join(process.env.VULTISIG_CONFIG_DIR!, 'agent-tokens.json')
    const seeded = { pk: { token: 'stale-tok', expiresAt: 9_999_999_999, refreshToken: 'old-rt' } }
    writeFileSync(storePath, JSON.stringify(seeded))
    // Re-auth succeeds but omits refreshToken (backend stopped returning one).
    vi.mocked(authenticateVault).mockResolvedValueOnce({ token: 'reauth-tok', expiresAt: 9_999_999_999 } as any)

    const ft = makeFakeThis()
    let calls = 0
    const request = vi.fn(async () => {
      calls++
      if (calls === 1) throw authError()
      return 'ok'
    })

    await expect((AgentSession.prototype as any).withAuthRetry.call(ft, request)).resolves.toBe('ok')

    const persisted = JSON.parse(readFileSync(storePath, 'utf-8'))
    expect(persisted.pk.token).toBe('reauth-tok')
    expect(persisted.pk.refreshToken).toBe('old-rt') // preserved, not dropped
  })
})
