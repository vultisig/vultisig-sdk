import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentErrorCode } from '../agentErrors'
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

function mockFetchSSE(chunks: string[], headers?: Record<string, string>): typeof fetch {
  return vi.fn(
    async () =>
      new Response(makeChunkedStream(chunks), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', ...headers },
      })
  ) as typeof fetch
}

/**
 * Stream that yields `chunks` then errors the body mid-flight to simulate a
 * dropped SSE connection. If `onBeforeError` is provided it runs right before
 * the body errors (used to flip an AbortController so the read loop sees a
 * user-cancel rather than a transport drop).
 */
function makeDroppingStream(chunks: string[], onBeforeError?: () => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]))
      } else {
        onBeforeError?.()
        controller.error(new Error('ECONNRESET: socket hang up'))
      }
    },
  })
}

function mockFetchDropping(
  chunks: string[],
  opts?: { headers?: Record<string, string>; onBeforeError?: () => void }
): typeof fetch {
  return vi.fn(
    async () =>
      new Response(makeDroppingStream(chunks, opts?.onBeforeError), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', ...opts?.headers },
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

    expect(onError).toHaveBeenCalledWith('something broke', AgentErrorCode.UNKNOWN_ERROR)
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

  // AI SDK v5 streaming: backend sends each event as a raw `data:` line with
  // the event type in the JSON payload, not via an `event:` header. This is
  // the format v-pxuw's agent-backend emits.
  it('routes AI SDK v5 (type-in-payload) events to the right callbacks', async () => {
    const onTextDelta = vi.fn()
    const onTitle = vi.fn()
    const onMessage = vi.fn()

    globalThis.fetch = mockFetchSSE([
      'data: {"type":"start","messageId":"m-1"}\n\n',
      'data: {"type":"text-start","id":"text-1"}\n\n',
      'data: {"type":"text-delta","id":"text-1","delta":"Hello "}\n\n',
      'data: {"type":"text-delta","id":"text-1","delta":"world"}\n\n',
      'data: {"type":"text-end","id":"text-1"}\n\n',
      'data: {"type":"data-title","data":{"title":"Greeting"}}\n\n',
      'data: {"type":"data-message","data":{"message":{"id":"m-1","conversation_id":"c1","role":"assistant","content":"Hello world","content_type":"text","created_at":"2026-04-17T00:00:00Z"}}}\n\n',
      'data: {"type":"data-usage","data":{"total_tokens":10}}\n\n',
      'data: {"type":"finish"}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream(
      'c1',
      { public_key: 'pk', content: 'hi' },
      { onTextDelta, onTitle, onMessage }
    )

    expect(result.fullText).toBe('Hello world')
    expect(result.message?.content).toBe('Hello world')
    expect(onTextDelta).toHaveBeenCalledTimes(2)
    expect(onTextDelta).toHaveBeenNthCalledWith(1, 'Hello ')
    expect(onTextDelta).toHaveBeenNthCalledWith(2, 'world')
    expect(onTitle).toHaveBeenCalledWith('Greeting')
    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  it('derives tool_progress status from v1 frame type and resolves toolName via toolCallId cache', async () => {
    const onToolProgress = vi.fn()

    globalThis.fetch = mockFetchSSE([
      'data: {"type":"tool-input-start","toolCallId":"call-1","toolName":"get_balance"}\n\n',
      'data: {"type":"tool-output-available","toolCallId":"call-1","output":{"ok":true}}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, { onToolProgress })

    expect(onToolProgress).toHaveBeenCalledTimes(2)
    expect(onToolProgress).toHaveBeenNthCalledWith(1, 'get_balance', 'running', undefined, undefined)
    // clean {"ok":true} output (no error markers) → ok=true on the done frame
    expect(onToolProgress).toHaveBeenNthCalledWith(2, 'get_balance', 'done', undefined, true)
  })

  it('legacy tool_progress events with inline status still route unchanged', async () => {
    const onToolProgress = vi.fn()

    globalThis.fetch = mockFetchSSE([
      'event: tool_progress\ndata: {"tool":"get_balance","status":"running","label":"fetching"}\n\n',
      'event: tool_progress\ndata: {"tool":"get_balance","status":"done"}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, { onToolProgress })

    expect(onToolProgress).toHaveBeenCalledTimes(2)
    expect(onToolProgress).toHaveBeenNthCalledWith(1, 'get_balance', 'running', 'fetching', undefined)
    // legacy 'done' with no output payload → ok=undefined (consumer falls back)
    expect(onToolProgress).toHaveBeenNthCalledWith(2, 'get_balance', 'done', undefined, undefined)
  })

  it('ignores v1 tool_progress frames where tool is not a string', async () => {
    const onToolProgress = vi.fn()

    globalThis.fetch = mockFetchSSE([
      'data: {"type":"tool-input-start","toolCallId":"call-bad","tool":{"nested":"object"}}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, { onToolProgress })

    expect(onToolProgress).not.toHaveBeenCalled()
  })

  it('handles v1 error events via errorText', async () => {
    const onError = vi.fn()
    globalThis.fetch = mockFetchSSE(['data: {"type":"error","errorText":"boom"}\n\n'])

    const client = new AgentClient('http://example.com')
    await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, { onError })

    expect(onError).toHaveBeenCalledWith('boom', AgentErrorCode.UNKNOWN_ERROR)
  })

  it('marks finished + captures X-Server-Now on a clean stream', async () => {
    globalThis.fetch = mockFetchSSE(
      [
        'data: {"type":"text-delta","id":"t","delta":"hi"}\n\n',
        'data: {"type":"data-message","data":{"message":{"id":"m","conversation_id":"c1","role":"assistant","content":"hi","content_type":"text","created_at":"2026-04-17T00:00:00Z"}}}\n\n',
        'data: {"type":"finish"}\n\n',
      ],
      { 'X-Server-Now': '1718870400000' }
    )

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.finished).toBe(true)
    expect(result.disconnected).toBe(false)
    expect(result.serverNow).toBe('1718870400000')
    expect(result.message?.content).toBe('hi')
  })

  // Disconnect-recovery contract: a transport drop mid-turn must NOT throw and
  // must NOT mark the turn finished — it flags `disconnected` so the caller can
  // recover via /messages/since. The X-Server-Now header (captured before the
  // first chunk) survives to anchor that recovery poll.
  it('flags disconnected (no throw, not finished) when the stream drops mid-turn', async () => {
    globalThis.fetch = mockFetchDropping(['data: {"type":"text-delta","id":"t","delta":"partial ans"}\n\n'], {
      headers: { 'X-Server-Now': '1718870400000' },
    })

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.disconnected).toBe(true)
    expect(result.finished).toBe(false)
    expect(result.message).toBeNull() // the answer never arrived on the wire
    expect(result.fullText).toBe('partial ans') // only the partial delta showed
    expect(result.serverNow).toBe('1718870400000')
  })

  // A deliberate Ctrl+C (AbortController.abort()) is NOT a dropped connection:
  // re-throw so the caller shows "[cancelled]" instead of silently recovering.
  it('re-throws (does not recover) when the read fails after a user abort', async () => {
    const ac = new AbortController()
    globalThis.fetch = mockFetchDropping(['data: {"type":"text-delta","id":"t","delta":"x"}\n\n'], {
      onBeforeError: () => ac.abort(),
    })

    const client = new AgentClient('http://example.com')
    await expect(client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {}, ac.signal)).rejects.toThrow()
  })
})

describe('AgentClient — honest tool success (fund-safety #B)', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  // Drive a tool through its lifecycle and capture the terminal
  // onToolProgress('done', …, ok) the consumer relies on for success.
  async function lastDoneOk(outputFrame: object): Promise<boolean | undefined> {
    globalThis.fetch = mockFetchSSE([
      'data: {"type":"tool-input-start","toolCallId":"t1","toolName":"execute_send"}\n\n',
      `data: ${JSON.stringify({ type: 'tool-output-available', toolCallId: 't1', ...outputFrame })}\n\n`,
    ])
    const calls: Array<{ status: string; ok?: boolean }> = []
    const client = new AgentClient('http://example.com')
    await client.sendMessageStream(
      'c1',
      { public_key: 'pk', content: 'hi' },
      { onToolProgress: (_t, status, _l, ok) => calls.push({ status, ok }) }
    )
    return calls.find(c => c.status === 'done')?.ok
  }

  it('reports ok=false when the tool output is {"status":"error"}', async () => {
    expect(
      await lastDoneOk({
        output: {
          status: 'error',
          error: 'execute_send (EVM): invalid address',
        },
      })
    ).toBe(false)
  })

  it('reports ok=false when the tool output has an {"error"} field', async () => {
    expect(await lastDoneOk({ output: { error: "isn't enough balance" } })).toBe(false)
  })

  it('reports ok=true for a clean tool output', async () => {
    expect(await lastDoneOk({ output: { tx_hash: '0xabc', status: 'pending' } })).toBe(true)
  })

  it('reports ok=undefined when no output is present (older-backend fallback)', async () => {
    expect(await lastDoneOk({})).toBeUndefined()
  })

  it('detects an error in a stringified output payload', async () => {
    expect(await lastDoneOk({ output: '{"status":"error","error":"boom"}' })).toBe(false)
  })

  // CodeRabbit #500: the string path was weaker than the object path.
  it('detects a stringified {"error":...} with no status field', async () => {
    expect(await lastDoneOk({ output: '{"error":"boom"}' })).toBe(false)
  })

  it('detects a stringified status:error with whitespace after the colon', async () => {
    expect(await lastDoneOk({ output: '{"status": "error", "message": "nope"}' })).toBe(false)
  })

  it('still treats a clean stringified payload as success', async () => {
    expect(await lastDoneOk({ output: '{"tx_hash":"0xabc","status":"pending"}' })).toBe(true)
  })
})
