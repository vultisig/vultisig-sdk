import { afterEach, describe, expect, it, vi } from 'vitest'

import { ExitCode } from '../../core/errors'
import { AgentClient, createTurnIdempotencyKey } from '../client'

function header(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name)
}

function sseResponse(): Response {
  return new Response('data: {"type":"finish"}\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('AgentClient message idempotency', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('sends a fresh visible-ASCII Idempotency-Key on each streaming message attempt', async () => {
    const fetchMock = vi.fn(async () => sseResponse())
    globalThis.fetch = fetchMock as typeof fetch
    const client = new AgentClient('http://example.com')

    await client.sendMessageStream('c1', { public_key: 'pk', content: 'first' }, {})
    await client.sendMessageStream('c1', { public_key: 'pk', content: 'second' }, {})

    const calls = fetchMock.mock.calls as unknown as Array<[unknown, RequestInit]>
    const first = header(calls[0]?.[1], 'Idempotency-Key')
    const second = header(calls[1]?.[1], 'Idempotency-Key')
    expect(first).toMatch(/^[\x21-\x7e]{1,255}$/)
    expect(second).toMatch(/^[\x21-\x7e]{1,255}$/)
    expect(second).not.toBe(first)
  })

  it('transmits a caller-supplied Idempotency-Key verbatim instead of substituting its own', async () => {
    const fetchMock = vi.fn(async () => sseResponse())
    globalThis.fetch = fetchMock as typeof fetch

    // The session owns key lifetime and passes its key explicitly; the client must
    // relay it untouched, or an auth replay would arrive under a different identity.
    await new AgentClient('http://example.com').sendMessageStream(
      'c1',
      { public_key: 'pk', content: 'first' },
      {},
      undefined,
      'session-owned-key'
    )

    const calls = fetchMock.mock.calls as unknown as Array<[unknown, RequestInit]>
    expect(header(calls[0]?.[1], 'Idempotency-Key')).toBe('session-owned-key')
  })

  it('generates keys that satisfy the backend 1-255 visible-ASCII contract', () => {
    const first = createTurnIdempotencyKey()
    const second = createTurnIdempotencyKey()
    expect(first).toMatch(/^[\x21-\x7e]{1,255}$/)
    expect(second).toMatch(/^[\x21-\x7e]{1,255}$/)
    expect(second).not.toBe(first)
  })

  it('sends an Idempotency-Key on the unary message POST', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ message: { id: 'm1', role: 'assistant', content: 'ok' }, actions: [] })
    )
    globalThis.fetch = fetchMock as typeof fetch

    await new AgentClient('http://example.com').sendMessage('c1', { public_key: 'pk', content: 'hello' })

    const calls = fetchMock.mock.calls as unknown as Array<[unknown, RequestInit]>
    expect(header(calls[0]?.[1], 'Idempotency-Key')).toMatch(/^[\x21-\x7e]{1,255}$/)
  })

  it('does not add the message idempotency header to other endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: 'c1' }))
      .mockResolvedValueOnce(Response.json({ messages: [], cursor: 'cursor-1' }))
    globalThis.fetch = fetchMock as typeof fetch
    const client = new AgentClient('http://example.com')

    await client.createConversation('pk')
    await client.messagesSince('c1', { since: '2026-07-16T00:00:00Z' })

    expect(header(fetchMock.mock.calls[0]?.[1] as RequestInit, 'Idempotency-Key')).toBeNull()
    expect(header(fetchMock.mock.calls[1]?.[1] as RequestInit, 'Idempotency-Key')).toBeNull()
  })

  it('maps the backend keyed-duplicate 409 to the dedicated typed CLI error', async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json(
        {
          error: 'this keyed turn was already accepted; inspect the conversation for its persisted result',
          code: 'idempotent_turn_duplicate',
          conversation_id: 'c1',
          first_request_at: '2026-07-16T00:00:00Z',
        },
        { status: 409 }
      )
    ) as typeof fetch

    const caught = await new AgentClient('http://example.com')
      .sendMessageStream('c1', { public_key: 'pk', content: 'hello' }, {}, undefined, 'k1')
      .catch((error: unknown) => error)

    expect(caught).toMatchObject({
      name: 'IdempotentTurnDuplicateError',
      code: 'IDEMPOTENT_TURN_DUPLICATE',
      exitCode: 14,
    })
    // first_request_at anchors the "inspect the conversation" remediation.
    expect((caught as { context?: Record<string, string> }).context).toMatchObject({
      conversationId: 'c1',
      firstRequestAt: '2026-07-16T00:00:00Z',
    })
  })

  // The reused-key 409 is the OPPOSITE of a duplicate: the claim belongs to a
  // different body, so THIS request never ran and no result was persisted for it.
  // It must not inherit exit 14's "already accepted, inspect the conversation"
  // contract — that would point automation at another request's result and
  // silently drop this intent.
  it('maps the backend reused-key 409 to a distinct typed error that does not claim acceptance', async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json(
        {
          error: 'Idempotency-Key was already used for a different request body',
          code: 'idempotency_key_reused',
          conversation_id: 'c1',
        },
        { status: 409 }
      )
    ) as typeof fetch

    const caught = await new AgentClient('http://example.com')
      .sendMessageStream('c1', { public_key: 'pk', content: 'hello' }, {}, undefined, 'k1')
      .catch((error: unknown) => error)

    expect(caught).toMatchObject({
      name: 'IdempotencyKeyReusedError',
      code: 'IDEMPOTENCY_KEY_REUSED',
      exitCode: ExitCode.INVALID_INPUT,
    })
    expect((caught as Error).message).not.toMatch(/already accepted/i)
  })

  it('maps the reused-key 409 on the unary POST too', async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json(
        { error: 'Idempotency-Key was already used for a different request body', code: 'idempotency_key_reused' },
        { status: 409 }
      )
    ) as typeof fetch

    const caught = await new AgentClient('http://example.com')
      .sendMessage('c1', { public_key: 'pk', content: 'hello' }, 'k1')
      .catch((error: unknown) => error)

    expect(caught).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', exitCode: ExitCode.INVALID_INPUT })
  })

  // A 409 the CLI does not own (e.g. the backend's pre-existing turn_in_flight)
  // must keep falling through to the generic error — the typed mapping is gated
  // on the code, not the status.
  it('leaves an unrelated 409 on its existing generic error path', async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({ error: 'a turn is already in flight', code: 'turn_in_flight' }, { status: 409 })
    ) as typeof fetch

    const caught = await new AgentClient('http://example.com')
      .sendMessageStream('c1', { public_key: 'pk', content: 'hello' }, {}, undefined, 'k1')
      .catch((error: unknown) => error)

    expect((caught as { code?: string }).code).toBeUndefined()
    expect((caught as Error).message).toContain('a turn is already in flight')
  })
})
