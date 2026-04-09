import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentClient } from '../client'

function makeChunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

describe('AgentClient.sendMessageStream', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('preserves SSE event state across chunk boundaries', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          makeChunkedStream([
            'event: text_delta\n',
            'data: {"delta":"Hello "}\n',
            '\n',
            'event: text_delta\n',
            'data: {"delta":"world"}\n',
            '\n',
            'event: message\n',
            'data: {"message":{"id":"m1","conversation_id":"c1","role":"assistant","content":"Hello world","content_type":"text","created_at":"2026-04-09T00:00:00Z"}}\n',
            '\n',
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }
        )
    ) as typeof fetch

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.fullText).toBe('Hello world')
    expect(result.message?.content).toBe('Hello world')
  })
})
