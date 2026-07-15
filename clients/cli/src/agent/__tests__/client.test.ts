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

  it('reports unknown V1 frame types as protocol drift while keeping known telemetry quiet', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    globalThis.fetch = mockFetchSSE([
      'data: {"type":"start","messageId":"m-1"}\n\n',
      'data: {"type":"data-usage","data":{"total_tokens":10}}\n\n',
      'data: {"type":"data-confirmation","data":{"required":true}}\n\n',
      'data: {"type":"data-future-critical","data":{"value":1}}\n\n',
      'data: {"type":"data-future-critical","data":{"value":2}}\n\n',
      'data: {"type":"finish"}\n\n',
    ])

    const client = new AgentClient('http://example.com')
    client.verbose = true
    const result = await client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})

    expect(result.protocolWarnings).toEqual([
      {
        code: 'PROTOCOL_DRIFT',
        message: 'Ignored 3 unknown SSE frames: data-confirmation, data-future-critical',
        count: 3,
        eventTypes: ['data-confirmation', 'data-future-critical'],
      },
    ])
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('[SSE] unknown frame type: data-confirmation'))
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('[SSE] unknown frame type: data-future-critical'))
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining('data-usage'))
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
      message: 'SSE stream idle timeout after 50ms without a frame',
    })
    expect(agentErrorCodeToExitCode(AgentErrorCode.TIMEOUT)).toBe(ExitCode.NETWORK)
    vi.useRealTimers()
  })

  it('resets the SSE idle deadline on keep-alive frames', async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
        c.enqueue(encoder.encode(': keep-alive\n\n'))
      },
    })
    globalThis.fetch = vi.fn(async () => new Response(stream, { status: 200 })) as typeof fetch

    const client = new AgentClient('http://example.com', 60_000, 50)
    const pending = client.sendMessageStream('c1', { public_key: 'pk', content: 'hi' }, {})
    await vi.advanceTimersByTimeAsync(40)
    controller.enqueue(encoder.encode(': keep-alive\n\n'))
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(40)
    controller.enqueue(encoder.encode('data: {"type":"finish"}\n\n'))
    controller.close()

    await expect(pending).resolves.toMatchObject({ finished: true, disconnected: false })
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

  it('defaults to 60000ms, safely above the backend keep-alive cadence', () => {
    delete process.env.VULTISIG_SSE_IDLE_TIMEOUT_MS
    expect(resolveSseIdleTimeoutMs()).toBe(60_000)
  })

  it('honors a valid positive override and rejects disabling typos', () => {
    process.env.VULTISIG_SSE_IDLE_TIMEOUT_MS = '90000'
    expect(resolveSseIdleTimeoutMs()).toBe(90_000)
    process.env.VULTISIG_SSE_IDLE_TIMEOUT_MS = '0'
    expect(resolveSseIdleTimeoutMs()).toBe(60_000)
  })
})
