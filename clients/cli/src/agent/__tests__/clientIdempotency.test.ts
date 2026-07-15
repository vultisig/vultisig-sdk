import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentClient } from '../client'

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
        },
        { status: 409 }
      )
    ) as typeof fetch

    const caught = await new AgentClient('http://example.com')
      .sendMessageStream('c1', { public_key: 'pk', content: 'hello' }, {})
      .catch((error: unknown) => error)

    expect(caught).toMatchObject({
      name: 'IdempotentTurnDuplicateError',
      code: 'IDEMPOTENT_TURN_DUPLICATE',
      exitCode: 14,
    })
  })
})
