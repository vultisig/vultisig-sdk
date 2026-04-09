import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentClient } from '../client'

/**
 * Creates a ReadableStream that yields one chunk per read() call.
 * Uses pull-based delivery to guarantee chunks are NOT coalesced by the runtime.
 */
function makeChunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]))
      } else {
        controller.close()
      }
    },
  })
}

function mockFetchSSE(chunks: string[]): typeof fetch {
  return vi.fn(
    async () =>
      new Response(makeChunkedStream(chunks), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
  ) as typeof fetch
}

describe('AgentClient.sendMessageStream', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('preserves SSE event state across chunk boundaries', async () => {
    const onTextDelta = vi.fn()
    const onMessage = vi.fn()

    globalThis.fetch = mockFetchSSE([
      'event: text_delta\n',
      'data: {"delta":"Hello "}\n',
      '\n',
      'event: text_delta\n',
      'data: {"delta":"world"}\n',
      '\n',
      'event: message\n',
      'data: {"message":{"id":"m1","conversation_id":"c1","role":"assistant","content":"Hello world","content_type":"text","created_at":"2026-04-09T00:00:00Z"}}\n',
      '\n',
    ])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, { onTextDelta, onMessage })

    expect(result.fullText).toBe('Hello world')
    expect(result.message?.content).toBe('Hello world')
    expect(onTextDelta).toHaveBeenCalledTimes(2)
    expect(onTextDelta).toHaveBeenNthCalledWith(1, 'Hello ')
    expect(onTextDelta).toHaveBeenNthCalledWith(2, 'world')
    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  it('handles multiple events in a single chunk', async () => {
    globalThis.fetch = mockFetchSSE([
      'event: text_delta\ndata: {"delta":"Hello "}\n\nevent: text_delta\ndata: {"delta":"world"}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.fullText).toBe('Hello world')
  })

  it('handles mid-line chunk splits', async () => {
    globalThis.fetch = mockFetchSSE(['event: text_del', 'ta\ndata: {"delta":"hi"}\n\n'])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.fullText).toBe('hi')
  })

  it('handles \\r\\n line endings', async () => {
    globalThis.fetch = mockFetchSSE(['event: text_delta\r\ndata: {"delta":"hi"}\r\n\r\n'])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.fullText).toBe('hi')
  })

  it('flushes last event when stream ends without trailing newline', async () => {
    globalThis.fetch = mockFetchSSE([
      'event: text_delta\ndata: {"delta":"hi"}\n\n',
      'event: text_delta\ndata: {"delta":" bye"}',
    ])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.fullText).toBe('hi bye')
  })

  it('ignores SSE comments without corrupting events', async () => {
    globalThis.fetch = mockFetchSSE([': keepalive\n', 'event: text_delta\n', ':ping\n', 'data: {"delta":"hi"}\n', '\n'])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.fullText).toBe('hi')
  })

  it('handles SSE fields without space after colon', async () => {
    globalThis.fetch = mockFetchSSE(['event:text_delta\ndata:{"delta":"hi"}\n\n'])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.fullText).toBe('hi')
  })

  it('defaults to "message" event type when no event: field', async () => {
    const onMessage = vi.fn()

    globalThis.fetch = mockFetchSSE([
      'data: {"message":{"id":"m1","conversation_id":"c1","role":"assistant","content":"hi","content_type":"text","created_at":"2026-04-09T00:00:00Z"}}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, { onMessage })

    expect(result.message?.content).toBe('hi')
    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  it('concatenates multi-line data: fields with newline separator', async () => {
    globalThis.fetch = mockFetchSSE(['event: text_delta\ndata: {"delta":\ndata: "hi"}\n\n'])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    // Multi-line data: fields are joined with \n, producing {"delta":\n"hi"} which is valid JSON
    expect(result.fullText).toBe('hi')
  })

  it('fires onError callback for error events', async () => {
    const onError = vi.fn()

    globalThis.fetch = mockFetchSSE(['event: error\ndata: {"error":"something broke"}\n\n'])

    const client = new AgentClient('http://example.com')
    await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, { onError })

    expect(onError).toHaveBeenCalledWith('something broke')
  })

  it('ignores bare colon comment lines', async () => {
    globalThis.fetch = mockFetchSSE([':\nevent: text_delta\ndata: {"delta":"hi"}\n\n'])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.fullText).toBe('hi')
  })

  it('skips malformed JSON data without throwing', async () => {
    globalThis.fetch = mockFetchSSE([
      'event: text_delta\ndata: {not valid json}\n\n',
      'event: text_delta\ndata: {"delta":"recovered"}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.fullText).toBe('recovered')
  })
})
