import { afterEach, describe, expect, it, vi } from 'vitest'

import { ExitCode } from '../../core/errors'
import { AgentErrorCode, agentErrorCodeToExitCode, normalizeAgentError } from '../agentErrors'
import { AgentClient, AgentStreamIdleTimeoutError, resolveHttpTimeoutMs, resolveSseIdleTimeoutMs } from '../client'

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

  // H2 (review of #1305): unknown `data-*` kinds are FORWARD-COMPATIBLE by the
  // backend's own V1 contract (`v1_wire_schema_test.go`) and some are emitted
  // from a dynamic site — `V1Data(streamSurface, …)` over the mutable
  // `genericCardSurfaces` map — that no static client list can track. Three
  // enumeration passes each found types the last had missed. So a `data-*` card
  // this CLI has no surface for is not drift: it is tolerated, quietly.
  //
  // The frames below are every UI-only card the two backends emit today (Go
  // agent.go quick_actions/vault_required/diagnostics + the streamSurface cards;
  // Go api/message.go checkout-wall; Mastra uiStream.ts agentStep) PLUS an
  // invented surface no CLI list has ever heard of. The invented one is the
  // point: under the old enumerate-everything design it stamped PROTOCOL_DRIFT
  // on a successful turn, and no test could have caught it, because the whole
  // failure mode is a surface that does not exist yet.
  it('tolerates unknown data-* cards quietly, including surfaces no list knows about', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    globalThis.fetch = mockFetchSSE([
      'data: {"type":"start","messageId":"m-1"}\n\n',
      'data: {"type":"data-usage","data":{"total_tokens":10}}\n\n',
      'data: {"type":"data-quick_actions","data":{"quick_actions":[]}}\n\n',
      'data: {"type":"data-vault_required","data":{"required":true}}\n\n',
      'data: {"type":"data-diagnostics","data":{"trace":"x"}}\n\n',
      'data: {"type":"data-checkout-wall","data":{"catalog":[]}}\n\n',
      'data: {"type":"data-agentStep","id":"c1-0","data":{"status":"running"}}\n\n',
      'data: {"type":"data-polymarket_markets","data":{"surface":"polymarket_markets"}}\n\n',
      'data: {"type":"data-yield_opportunities","data":{"surface":"yield_opportunities"}}\n\n',
      'data: {"type":"data-yield_position","data":{"surface":"yield_position"}}\n\n',
      'data: {"type":"data-confirmation","data":{"required":true}}\n\n',
      // A surface invented for this test — stands in for whatever the backend
      // registers next. The CLI must not editorialise about it to machines.
      'data: {"type":"data-surface_from_the_future","data":{"value":1}}\n\n',
      'data: {"type":"finish"}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    client.verbose = true
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.finished).toBe(true)
    expect(result.protocolWarnings).toEqual([])
    // Tolerated ≠ hidden: a developer running --verbose still sees them.
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('[SSE] tolerated unknown data frame: data-surface_from_the_future')
    )
    // ...but a frame we route (data-usage → 'ignore') is not even that.
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining('tolerated unknown data frame: data-usage'))
  })

  // A genuinely unexpected PROTOCOL-level frame (not a `data-*` card, so not
  // covered by the forward-compat contract) is still recorded — but only under
  // --verbose. PROTOCOL_DRIFT is a debug aid, not a machine contract: warning by
  // default fires on healthy turns against a newer backend, and a detector that
  // fires on ~every healthy turn is one automation learns to filter out.
  it('records unknown non-data frames as drift only under verbose', async () => {
    const frames = [
      'data: {"type":"start","messageId":"m-1"}\n\n',
      'data: {"type":"reasoning-delta","delta":"hmm"}\n\n',
      'data: {"type":"reasoning-delta","delta":"hmm2"}\n\n',
      'data: {"type":"finish"}\n\n',
    ]

    globalThis.fetch = mockFetchSSE([...frames])
    const quiet = new AgentClient('http://example.com')
    const quietResult = await quiet.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})
    expect(quietResult.protocolWarnings).toEqual([])

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    globalThis.fetch = mockFetchSSE([...frames])
    const loud = new AgentClient('http://example.com')
    loud.verbose = true
    const loudResult = await loud.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})
    expect(loudResult.protocolWarnings).toEqual([
      {
        code: 'PROTOCOL_DRIFT',
        message: 'Ignored 2 unknown SSE frames: reasoning-delta',
        count: 2,
        eventTypes: ['reasoning-delta'],
      },
    ])
  })

  // Frame `type` is backend-controlled and lands in the ask JSON envelope, so
  // both the number of distinct types and each type's length stay bounded.
  it('caps the distinct frame types recorded in a drift warning while keeping the count exact', async () => {
    const frames = Array.from({ length: 25 }, (_, i) => `data: {"type":"junk-${i}"}\n\n`)
    globalThis.fetch = mockFetchSSE([
      'data: {"type":"start","messageId":"m-1"}\n\n',
      ...frames,
      'data: {"type":"finish"}\n\n',
    ])
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const client = new AgentClient('http://example.com')
    client.verbose = true
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    const [warning] = result.protocolWarnings
    expect(warning?.count).toBe(25)
    expect(warning?.eventTypes).toHaveLength(10)
  })

  it('truncates an oversized frame type instead of echoing it whole', async () => {
    globalThis.fetch = mockFetchSSE([
      'data: {"type":"start","messageId":"m-1"}\n\n',
      `data: {"type":"${'x'.repeat(500)}"}\n\n`,
      'data: {"type":"finish"}\n\n',
    ])
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const client = new AgentClient('http://example.com')
    client.verbose = true
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    const [warning] = result.protocolWarnings
    expect(warning?.eventTypes).toHaveLength(1)
    expect(warning?.eventTypes[0]).toHaveLength(65)
    expect(warning?.eventTypes[0]).toMatch(/…$/)
  })

  // H2, the dangerous half. `tool-output-error` is the backend's explicit tool
  // FAILURE terminal (`V1ToolOutputError`, protocol_v1.go). Ignoring it is not a
  // display gap: the call gets no terminal frame at all, so the tool never
  // reports done, the turn records no failure, and — in the backend's own words
  // — that "lets the LLM's same-turn prose claim success even though no action
  // ever ran". It must land as a done/ok:false tool result, the same typed
  // failure shape `tool-output-available` with an error payload produces.
  it('surfaces tool-output-error as a failed tool result, not silence', async () => {
    const onToolProgress = vi.fn()
    globalThis.fetch = mockFetchSSE([
      'data: {"type":"tool-input-available","toolCallId":"call-1","toolName":"execute_swap","input":{}}\n\n',
      'data: {"type":"tool-output-error","toolCallId":"call-1","errorText":"swap builder timed out"}\n\n',
      'data: {"type":"finish"}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, { onToolProgress })

    // toolName is resolved from the toolCallId cache — the frame carries only
    // toolCallId + errorText, never a name.
    expect(onToolProgress).toHaveBeenCalledWith('execute_swap', 'done', undefined, false)
    // Not drift — it is a frame we now handle.
    expect(result.protocolWarnings).toEqual([])
  })

  // Fund-safety: the error terminal reports status 'done', which is the same
  // status that gates the tool-output→sign bridge. A FAILED tool must never
  // produce a signable candidate.
  it('never derives a signable candidate from a tool-output-error', async () => {
    const onToolOutputTx = vi.fn()
    globalThis.fetch = mockFetchSSE([
      'data: {"type":"tool-input-available","toolCallId":"call-1","toolName":"execute_swap","input":{}}\n\n',
      'data: {"type":"tool-output-error","toolCallId":"call-1","errorText":"boom"}\n\n',
      'data: {"type":"finish"}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, { onToolOutputTx })

    expect(onToolOutputTx).not.toHaveBeenCalled()
  })

  // H2, the other dangerous half — and the sharpest one. The backend emits
  // `text-replace` precisely when it has decided the prose it already streamed
  // is WRONG and must be discarded (protocol_v1.go: a client "MUST locate the
  // existing part with id==replaces and overwrite its text"). Ignoring it means
  // `fullText` — which session.ts turns into `responseText`, the `response`
  // field of `agent ask --output json` — keeps the RETRACTED claim. On current
  // main this test's stream answers "I sent your 5 ETH." after the backend
  // retracted exactly that sentence.
  it('applies text-replace so the turn answers with the corrected text, not the retracted one', async () => {
    globalThis.fetch = mockFetchSSE([
      'data: {"type":"text-start","id":"t1"}\n\n',
      'data: {"type":"text-delta","id":"t1","delta":"I sent your 5 ETH."}\n\n',
      'data: {"type":"text-end","id":"t1"}\n\n',
      'data: {"type":"text-replace","replaces":"t1","text":"I could not send your ETH."}\n\n',
      'data: {"type":"finish"}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.fullText).toBe('I could not send your ETH.')
    expect(result.protocolWarnings).toEqual([])
  })

  it('replaces only the retracted part, preserving surrounding parts and their order', async () => {
    globalThis.fetch = mockFetchSSE([
      'data: {"type":"text-delta","id":"t1","delta":"First. "}\n\n',
      'data: {"type":"text-delta","id":"t2","delta":"WRONG."}\n\n',
      'data: {"type":"text-delta","id":"t3","delta":" Last."}\n\n',
      'data: {"type":"text-replace","replaces":"t2","text":"Right."}\n\n',
      'data: {"type":"finish"}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.fullText).toBe('First. Right. Last.')
  })

  // Degrade safely, never half-apply. A stream whose deltas carried no `id`
  // cannot be recomposed from parts without DROPPING that prose, so the
  // replacement is declined and the text stands as streamed — something the
  // backend actually said — rather than being partially rebuilt.
  it('declines a text-replace it cannot apply rather than corrupting the text', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    globalThis.fetch = mockFetchSSE([
      // Legacy/id-less delta: not attributable to a part.
      'data: {"type":"text-delta","delta":"streamed prose"}\n\n',
      'data: {"type":"text-replace","replaces":"t1","text":"correction"}\n\n',
      'data: {"type":"finish"}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    client.verbose = true
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.fullText).toBe('streamed prose')
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('[SSE] text-replace not applied'))
  })

  it('declines a text-replace targeting a part it never saw', async () => {
    globalThis.fetch = mockFetchSSE([
      'data: {"type":"text-delta","id":"t1","delta":"hello"}\n\n',
      'data: {"type":"text-replace","replaces":"nonexistent","text":"correction"}\n\n',
      'data: {"type":"finish"}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.fullText).toBe('hello')
  })

  it('keeps start-step quiet instead of reporting it as drift', async () => {
    globalThis.fetch = mockFetchSSE([
      'data: {"type":"start","messageId":"m-1"}\n\n',
      'data: {"type":"start-step"}\n\n',
      'data: {"type":"text-delta","id":"t1","delta":"hi"}\n\n',
      'data: {"type":"finish-step"}\n\n',
      'data: {"type":"finish"}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.protocolWarnings).toEqual([])
    expect(result.fullText).toBe('hi')
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

  // #927 Phase 2: the CLI derives a client-side signable candidate from the
  // tool-output-available channel and hands it to the session via `onToolOutputTx`
  // — the sole signing source. Flat tools (polymarket / build_custom_* /
  // erc20_approve) and `execute_*` prep tools both produce signable candidates.
  describe('tool-output signing bridge: tool-output-available → onToolOutputTx', () => {
    const USDC_E = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
    const APPROVE_DATA = '0x095ea7b3' + '0'.repeat(120)

    function outputFrame(toolName: string, output: object): string[] {
      return [
        `data: ${JSON.stringify({ type: 'tool-input-start', toolCallId: 'tc-pm', toolName })}\n\n`,
        `data: ${JSON.stringify({ type: 'tool-output-available', toolCallId: 'tc-pm', output })}\n\n`,
        'data: {"type":"finish"}\n\n',
      ]
    }

    it('fires onToolOutputTx (flat) with a wrapped {chain,chain_id,tx} for an allowlisted flat envelope', async () => {
      const onToolOutputTx = vi.fn()
      globalThis.fetch = mockFetchSSE(
        outputFrame('polymarket_setup_trading', {
          chain: 'Polygon',
          chain_id: '137',
          to: USDC_E,
          value: '0',
          data: APPROVE_DATA,
          action: 'approve',
        })
      )

      const client = new AgentClient('http://example.com')
      await client.sendMessageStream('c1', { public_key: 'pk', content: 'approve' }, { onToolOutputTx })

      expect(onToolOutputTx).toHaveBeenCalledTimes(1)
      expect(onToolOutputTx.mock.calls[0][0]).toMatchObject({
        __buildTx: true,
        chain: 'Polygon',
        chain_id: '137',
        tx: { to: USDC_E, value: '0', data: APPROVE_DATA },
      })
      expect(onToolOutputTx.mock.calls[0][1]).toBe('polymarket_setup_trading')
      expect(onToolOutputTx.mock.calls[0][2]).toBe('flat')
    })

    it('fires onToolOutputTx with a multi-leg {approvalTxArgs,txArgs} for a bundled deposit wrap', async () => {
      const onToolOutputTx = vi.fn()
      const ONRAMP = '0x1234567890abcdef1234567890abcdef12345678'
      const WRAP_DATA = '0x62355638' + '0'.repeat(192)
      globalThis.fetch = mockFetchSSE(
        outputFrame('polymarket_deposit', {
          chain: 'Polygon',
          chain_id: '137',
          to: ONRAMP,
          value: '0',
          data: WRAP_DATA,
          gas_limit: '250000',
          action: 'wrap_usdce_to_pusd',
          needs_approval: true,
          approval_tx: { to: USDC_E, data: APPROVE_DATA, value: '0' },
        })
      )

      const client = new AgentClient('http://example.com')
      await client.sendMessageStream('c1', { public_key: 'pk', content: 'deposit' }, { onToolOutputTx })

      expect(onToolOutputTx).toHaveBeenCalledTimes(1)
      expect(onToolOutputTx.mock.calls[0][0]).toMatchObject({
        __buildTx: true,
        chain: 'Polygon',
        approvalTxArgs: { tx: { to: USDC_E, data: APPROVE_DATA } },
        txArgs: { tx: { to: ONRAMP, data: WRAP_DATA, gas_limit: '250000' } },
      })
    })

    it('fires onToolOutputTx (prep) for an execute_* prep envelope with tx_encoding (sign source)', async () => {
      const onToolOutputTx = vi.fn()
      globalThis.fetch = mockFetchSSE(
        outputFrame('execute_send', {
          txArgs: {
            chain: 'Base',
            chain_id: '8453',
            tx_encoding: 'evm-tx',
            tx: { to: USDC_E, value: '0', data: APPROVE_DATA },
          },
          stepperConfig: {},
          resolved: {},
        })
      )

      const client = new AgentClient('http://example.com')
      await client.sendMessageStream('c1', { public_key: 'pk', content: 'send' }, { onToolOutputTx })

      expect(onToolOutputTx).toHaveBeenCalledTimes(1)
      expect(onToolOutputTx.mock.calls[0][2]).toBe('prep')
    })

    it('ignores the hollow data-tx_ready marker — only the tool-output candidate fires (Phase 2)', async () => {
      // Production emits data-tx_ready as a hollow {typed_confirm} marker with NO
      // tx body; the signable payload rides tool-output-available. The client must
      // sign PURELY off tool-output and ignore the marker frame.
      const onToolOutputTx = vi.fn()
      globalThis.fetch = mockFetchSSE([
        `data: ${JSON.stringify({ type: 'tool-input-start', toolCallId: 'tc-send', toolName: 'execute_send' })}\n\n`,
        `data: ${JSON.stringify({
          type: 'tool-output-available',
          toolCallId: 'tc-send',
          output: {
            txArgs: {
              chain: 'Base',
              chain_id: '8453',
              tx_encoding: 'evm-tx',
              tx: { to: USDC_E, value: '0', data: APPROVE_DATA },
            },
            stepperConfig: {},
            resolved: {},
          },
        })}\n\n`,
        `data: ${JSON.stringify({ type: 'data-tx_ready', id: 'tc-send-txr', data: { typed_confirm: true } })}\n\n`,
        'data: {"type":"finish"}\n\n',
      ])

      const client = new AgentClient('http://example.com')
      await client.sendMessageStream('c1', { public_key: 'pk', content: 'send' }, { onToolOutputTx })

      // The tool-output candidate is the sole signing signal; the hollow marker is a no-op.
      expect(onToolOutputTx).toHaveBeenCalledTimes(1)
      expect(onToolOutputTx.mock.calls[0][1]).toBe('execute_send')
      expect(onToolOutputTx.mock.calls[0][2]).toBe('prep')
    })

    it('does NOT fire onToolOutputTx for an execute_* prep envelope MISSING tx_encoding (backend phantom-card guard)', async () => {
      const onToolOutputTx = vi.fn()
      globalThis.fetch = mockFetchSSE(
        outputFrame('execute_send', {
          txArgs: {
            chain: 'Base',
            chain_id: '8453',
            tx: { to: USDC_E, value: '0', data: APPROVE_DATA },
          },
          stepperConfig: {},
        })
      )

      const client = new AgentClient('http://example.com')
      await client.sendMessageStream('c1', { public_key: 'pk', content: 'send' }, { onToolOutputTx })

      expect(onToolOutputTx).not.toHaveBeenCalled()
    })

    it('does NOT fire onToolOutputTx for a no_op envelope (guard)', async () => {
      const onToolOutputTx = vi.fn()
      globalThis.fetch = mockFetchSSE(
        outputFrame('polymarket_setup_trading', {
          chain: 'Polygon',
          chain_id: '137',
          action: 'no_op',
          message: 'All spenders approved.',
        })
      )

      const client = new AgentClient('http://example.com')
      await client.sendMessageStream('c1', { public_key: 'pk', content: 'approve' }, { onToolOutputTx })

      expect(onToolOutputTx).not.toHaveBeenCalled()
    })

    it('does NOT fire onToolOutputTx for a tool outside the allowlist', async () => {
      const onToolOutputTx = vi.fn()
      globalThis.fetch = mockFetchSSE(
        outputFrame('polymarket_place_bet', {
          chain: 'Polygon',
          chain_id: '137',
          to: USDC_E,
          value: '0',
          data: APPROVE_DATA,
        })
      )

      const client = new AgentClient('http://example.com')
      await client.sendMessageStream('c1', { public_key: 'pk', content: 'bet' }, { onToolOutputTx })

      expect(onToolOutputTx).not.toHaveBeenCalled()
    })
  })

  // cat4-cli-supported-surfaces: the backend emits data-balance_summary when
  // the client advertised "balance_summary" in supported_surfaces. Previously
  // this v1 part routed to the 'ignore' bucket (client.ts:421) and the card was
  // silently dropped; now it surfaces via onBalanceSummary.
  it('routes data-balance_summary to onBalanceSummary with the envelope payload', async () => {
    const onBalanceSummary = vi.fn()

    const envelope = {
      surface: 'balance_summary',
      accounts: [
        {
          chainId: 'Ethereum',
          address: '0xabc',
          tokens: [{ symbol: 'ETH', amountDecimal: '1.0' }],
        },
      ],
    }

    globalThis.fetch = mockFetchSSE([
      `data: ${JSON.stringify({ type: 'data-balance_summary', data: envelope })}\n\n`,
      'data: {"type":"finish"}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    await client.sendMessageStream('c1', { public_key: 'pk', content: 'balance' }, { onBalanceSummary })

    expect(onBalanceSummary).toHaveBeenCalledTimes(1)
    expect(onBalanceSummary).toHaveBeenCalledWith(envelope)
  })

  // a2a-02: the backend emits data-turn_outcome at turn end when the client
  // advertised the `turn_outcome` surface. Route it to onTurnOutcome so a headless
  // caller learns the typed ending without parsing prose.
  it('routes data-turn_outcome to onTurnOutcome with the typed payload', async () => {
    const onTurnOutcome = vi.fn()
    const outcome = { kind: 'blocked', code: 'broadcast-claim', detail: 'I cannot confirm that broadcast' }

    globalThis.fetch = mockFetchSSE([
      `data: ${JSON.stringify({ type: 'data-turn_outcome', id: 'turn-outcome', data: outcome })}\n\n`,
      'data: {"type":"finish"}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    await client.sendMessageStream('c1', { public_key: 'pk', content: 'send' }, { onTurnOutcome })

    expect(onTurnOutcome).toHaveBeenCalledTimes(1)
    expect(onTurnOutcome).toHaveBeenCalledWith(outcome)
  })

  it('drops a malformed data-turn_outcome (unknown kind) instead of firing onTurnOutcome', async () => {
    const onTurnOutcome = vi.fn()
    globalThis.fetch = mockFetchSSE([
      `data: ${JSON.stringify({ type: 'data-turn_outcome', data: { kind: 'weird' } })}\n\n`,
      'data: {"type":"finish"}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    await client.sendMessageStream('c1', { public_key: 'pk', content: 'send' }, { onTurnOutcome })

    expect(onTurnOutcome).not.toHaveBeenCalled()
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

/**
 * Mimics fetch's abort contract: never resolves, but rejects with the signal's
 * abort reason once the (timeout/caller) signal fires — so a stalled backend is
 * indistinguishable from a half-open socket. Without the timeout work this hangs
 * forever (the vitest test would time out / go red); with it the call rejects
 * within `timeoutMs`.
 */
function mockHangingFetch(): typeof fetch {
  return vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) return // no signal → genuinely hangs (the bug we're fixing)
        if (signal.aborted) {
          reject(signal.reason)
          return
        }
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        })
      })
  ) as typeof fetch
}

describe('AgentClient — request timeouts (headless-hang guard)', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  const authReq = {
    public_key: 'pk',
    chain_code_hex: 'cc',
    message: 'm',
    signature: 's',
  }

  it('healthCheck resolves false when the request hangs past the timeout', async () => {
    globalThis.fetch = mockHangingFetch()
    const client = new AgentClient('http://example.com', 20)
    await expect(client.healthCheck()).resolves.toBe(false)
  })

  it('rejects a unary POST with a clear timeout error when it hangs', async () => {
    globalThis.fetch = mockHangingFetch()
    const client = new AgentClient('http://example.com', 20)
    await expect(client.createConversation('pk')).rejects.toThrow(/request timed out after 20ms/)
  })

  it('rejects a unary DELETE with a timeout error when it hangs', async () => {
    globalThis.fetch = mockHangingFetch()
    const client = new AgentClient('http://example.com', 20)
    await expect(client.deleteConversation('c1', 'pk')).rejects.toThrow(/request timed out after 20ms/)
  })

  it('rejects authenticate with a timeout error when it hangs', async () => {
    globalThis.fetch = mockHangingFetch()
    const client = new AgentClient('http://example.com', 20)
    await expect(client.authenticate(authReq)).rejects.toThrow(/request timed out after 20ms/)
  })

  it('rejects a unary GET (messagesSince) with a timeout error when it hangs', async () => {
    globalThis.fetch = mockHangingFetch()
    const client = new AgentClient('http://example.com', 20)
    await expect(client.messagesSince('c1', { since: '2026-01-01T00:00:00Z' })).rejects.toThrow(
      /request timed out after 20ms/
    )
  })

  // Body-read timeout normalization (CodeRabbit, client.ts unary helpers): if the
  // backend sends headers then stalls the JSON body, fetch() has already resolved,
  // so the timeout surfaces during res.json(). Build a Response whose .json()
  // rejects with a TimeoutError and assert the unary path still surfaces the
  // normalized "request timed out after Nms" error rather than leaking the raw
  // abort (success path) or masking it as the statusText fallback (non-OK path).
  function mockFetchJsonTimesOut(status: number): typeof fetch {
    return vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
    })) as unknown as typeof fetch
  }

  it('surfaces a timeout when the SUCCESS body stalls during res.json()', async () => {
    globalThis.fetch = mockFetchJsonTimesOut(200)
    const client = new AgentClient('http://example.com', 20)
    await expect(client.createConversation('pk')).rejects.toThrow(/request timed out after 20ms/)
  })

  it('surfaces a timeout when the NON-OK error body stalls during res.json()', async () => {
    globalThis.fetch = mockFetchJsonTimesOut(500)
    const client = new AgentClient('http://example.com', 20)
    // Must NOT swallow the timeout as the statusText fallback ("Request failed (500): Internal Server Error").
    await expect(client.createConversation('pk')).rejects.toThrow(/request timed out after 20ms/)
  })

  it('rejects sendMessageStream with a timeout error when the connect hangs', async () => {
    globalThis.fetch = mockHangingFetch()
    const client = new AgentClient('http://example.com', 20)
    await expect(client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})).rejects.toThrow(
      /request timed out after 20ms/
    )
  })

  // Cancellation must survive the combined-signal path: a caller Ctrl+C aborts
  // the connect, and it must surface as a deliberate cancel (the original abort
  // reason), NOT be mislabeled as a timeout. Asserting the positive AbortError
  // identity (not merely "no timeout text") guards against a regression that
  // swallowed the abort into some unrelated error.
  it('still aborts sendMessageStream on a caller signal, preserving cancel semantics', async () => {
    globalThis.fetch = mockHangingFetch()
    const ac = new AbortController()
    // Large timeout so the caller abort — not the deadline — wins the race.
    const client = new AgentClient('http://example.com', 60_000)
    const p = client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {}, ac.signal)
    ac.abort()
    const err = await p.then(
      () => {
        throw new Error('expected rejection')
      },
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(DOMException)
    expect((err as DOMException).name).toBe('AbortError')
    expect(String((err as Error).message)).not.toMatch(/timed out/)
  })

  // The connect deadline must bound ONLY the initial connect, never the
  // long-lived SSE body. With a tiny timeout but a body whose terminal frame
  // arrives well after that deadline, the stream must still complete cleanly
  // (finished, not disconnected) — proving the connect timer is cleared once
  // headers arrive and can't abort the live read.
  it('does not abort the SSE body when it streams past the connect timeout', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"text-delta","id":"t","delta":"slow"}\n\n'))
        // Emit the terminal frame after a delay far exceeding the 15ms connect
        // deadline; a body-level timeout would abort here and flag disconnected.
        await new Promise(r => setTimeout(r, 120))
        controller.enqueue(encoder.encode('data: {"type":"finish"}\n\n'))
        controller.close()
      },
    })
    globalThis.fetch = vi.fn(
      async () =>
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
    ) as typeof fetch

    const client = new AgentClient('http://example.com', 15)
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.finished).toBe(true)
    expect(result.disconnected).toBe(false)
    expect(result.fullText).toBe('slow')
  })

  it('rejects with a typed TIMEOUT when an established SSE stream stops producing frames', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': keep-alive\n\n'))
        // Deliberately never enqueue another frame or close.
      },
    })
    globalThis.fetch = vi.fn(async () => new Response(stream, { status: 200 })) as typeof fetch

    const client = new AgentClient('http://example.com', 60_000, 50)
    const pending = client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})
    await vi.advanceTimersByTimeAsync(49)

    let settled = false
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await Promise.resolve()
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    const error = await pending.catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      name: 'AgentStreamIdleTimeoutError',
      code: AgentErrorCode.TIMEOUT,
    })
    expect(error).toBeInstanceOf(AgentStreamIdleTimeoutError)
    expect(normalizeAgentError(error)).toEqual({
      code: AgentErrorCode.TIMEOUT,
      message: 'SSE stream idle timeout after 50ms without progress',
    })
    expect(agentErrorCodeToExitCode(AgentErrorCode.TIMEOUT)).toBe(ExitCode.NETWORK)
    vi.useRealTimers()
  })

  it('does not reset the SSE idle deadline on bare blank lines', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
    })
    globalThis.fetch = vi.fn(async () => new Response(stream, { status: 200 })) as typeof fetch

    const client = new AgentClient('http://example.com', 60_000, 50)
    const pending = client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})
    const caught = pending.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(40)
    controller.enqueue(encoder.encode('\n'))
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(10)

    await expect(caught).resolves.toBeInstanceOf(AgentStreamIdleTimeoutError)
    vi.useRealTimers()
  })

  // H1 (review of #1305): the deadline exists to bound a HUNG BACKEND. Both
  // backends heartbeat from a ticker that runs independently of turn progress
  // (Go `internal/api/message.go` writes `": ping"` every 15s from a safego
  // goroutine; Mastra `withSseHeartbeat(resp, 15_000)`), so a clock that
  // keep-alives reset bounds only a dead transport — the wedged backend pings
  // forever and `agent ask` hangs exactly as it did pre-#1305. This test
  // replaces one that asserted the opposite (keep-alives DO reset), which
  // encoded the defect as the contract.
  it('bounds a heartbeating-but-wedged backend: keep-alives do not defer the deadline', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
        // The turn starts and produces real output, then the agent loop wedges
        // and only the heartbeat goroutine keeps writing.
        c.enqueue(encoder.encode('data: {"type":"text-delta","id":"t1","delta":"thinking"}\n\n'))
      },
    })
    globalThis.fetch = vi.fn(async () => new Response(stream, { status: 200 })) as typeof fetch

    const client = new AgentClient('http://example.com', 60_000, 50)
    const pending = client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})
    const caught = pending.catch((error: unknown) => error)

    // Pings at 40ms against a 50ms deadline — the real 15s/180s ratio is far
    // wider, so this is a conservative stand-in for "heartbeating forever".
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(40)
      // Once the deadline fires the reader is cancelled and the stream closes;
      // stop pinging then, exactly as the real backend's heartbeat exits on a
      // write error to a dead socket.
      try {
        controller.enqueue(encoder.encode(': ping\n\n'))
      } catch {
        break
      }
      await Promise.resolve()
    }

    await expect(caught).resolves.toBeInstanceOf(AgentStreamIdleTimeoutError)
    vi.useRealTimers()
  })

  // The no-false-positive property the review verified must survive the change:
  // a turn that is SLOW but genuinely progressing still resets the clock, since
  // real data frames — unlike comments — prove the agent loop advanced.
  it('does not time out a slow-but-progressing turn', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
    })
    globalThis.fetch = vi.fn(async () => new Response(stream, { status: 200 })) as typeof fetch

    const client = new AgentClient('http://example.com', 60_000, 50)
    const pending = client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    // 4 × 40ms = 160ms of wall clock, 3× the 50ms deadline — survived only
    // because each frame is real progress.
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(40)
      controller.enqueue(encoder.encode(`data: {"type":"text-delta","id":"t1","delta":"tick"}\n\n`))
      await Promise.resolve()
    }
    controller.enqueue(encoder.encode('data: {"type":"finish"}\n\n'))
    controller.close()

    await expect(pending).resolves.toMatchObject({
      finished: true,
      disconnected: false,
      fullText: 'ticktickticktick',
    })
    vi.useRealTimers()
  })
})

describe('resolveHttpTimeoutMs (VULTISIG_HTTP_TIMEOUT_MS parsing)', () => {
  const original = process.env.VULTISIG_HTTP_TIMEOUT_MS
  afterEach(() => {
    if (original === undefined) delete process.env.VULTISIG_HTTP_TIMEOUT_MS
    else process.env.VULTISIG_HTTP_TIMEOUT_MS = original
  })

  it('defaults to 30000 when the env var is unset', () => {
    delete process.env.VULTISIG_HTTP_TIMEOUT_MS
    expect(resolveHttpTimeoutMs()).toBe(30_000)
  })

  it('honors a valid positive override', () => {
    process.env.VULTISIG_HTTP_TIMEOUT_MS = '5000'
    expect(resolveHttpTimeoutMs()).toBe(5000)
  })

  // "A typo can't disable the timeout": junk / non-positive values fall back to
  // the default rather than producing 0/NaN (which would neuter the bound).
  it.each(['', '   ', 'abc', '0', '-5', 'NaN', 'Infinity'])('falls back to the default for invalid value %j', val => {
    process.env.VULTISIG_HTTP_TIMEOUT_MS = val
    expect(resolveHttpTimeoutMs()).toBe(30_000)
  })
})

describe('resolveSseIdleTimeoutMs (VULTISIG_SSE_IDLE_TIMEOUT_MS parsing)', () => {
  const original = process.env.VULTISIG_SSE_IDLE_TIMEOUT_MS
  afterEach(() => {
    if (original === undefined) delete process.env.VULTISIG_SSE_IDLE_TIMEOUT_MS
    else process.env.VULTISIG_SSE_IDLE_TIMEOUT_MS = original
  })

  // 180s, not the previous 60s: now that keep-alives no longer defer the
  // deadline it measures real backend SILENCE, and a healthy turn is documented
  // to be silent for up to ~150s (claudeRequestTimeout 90s + 60s MCP). It stays
  // below the backend's own 5min agentTurnMaxDuration so a wedge is still bounded.
  it('defaults to 180000ms, above the backend worst-case silent stretch', () => {
    delete process.env.VULTISIG_SSE_IDLE_TIMEOUT_MS
    expect(resolveSseIdleTimeoutMs()).toBe(180_000)
  })

  it('honors a valid positive override and rejects disabling typos', () => {
    process.env.VULTISIG_SSE_IDLE_TIMEOUT_MS = '90000'
    expect(resolveSseIdleTimeoutMs()).toBe(90_000)
    process.env.VULTISIG_SSE_IDLE_TIMEOUT_MS = '0'
    expect(resolveSseIdleTimeoutMs()).toBe(180_000)
  })
})
