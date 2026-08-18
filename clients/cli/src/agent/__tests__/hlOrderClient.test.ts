import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentClient } from '../client'

describe('AgentClient Hyperliquid direct contract', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('uses authenticated direct retrieve/submit/status endpoints and never a chat turn', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(JSON.stringify({ state: 'filled' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    const client = new AgentClient('https://backend.example')
    client.setAuthToken('jwt-secret')

    await client.retrieveHlOrderSigningPayload('ref-123456789012', 'conv-1', 'pk-1')
    await client.submitHlOrder('ref-123456789012', 'conv-1', 'pk-1', [
      {
        kind: 'order',
        digest: `0x${'1'.repeat(64)}`,
        r: `0x${'2'.repeat(64)}`,
        s: `0x${'3'.repeat(64)}`,
        v: 27,
      },
    ])
    await client.getHlOrderStatus('ref-123456789012', 'conv-1', 'pk-1')

    expect(calls.map(call => call.url)).toEqual([
      'https://backend.example/agent/hyperliquid/orders/ref-123456789012/signing-payload',
      'https://backend.example/agent/hyperliquid/orders/ref-123456789012/submit',
      'https://backend.example/agent/hyperliquid/orders/ref-123456789012/status',
    ])
    expect(
      calls.every(call => (call.init.headers as Record<string, string>).Authorization === 'Bearer jwt-secret')
    ).toBe(true)
    expect(calls.every(call => !call.url.includes('/messages'))).toBe(true)
    expect(JSON.parse(calls[1]!.init.body as string)).toMatchObject({
      conversation_id: 'conv-1',
      public_key: 'pk-1',
      signatures: [expect.objectContaining({ kind: 'order' })],
    })
  })
})
