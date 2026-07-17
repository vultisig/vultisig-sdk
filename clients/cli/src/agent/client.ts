/**
 * Agent Backend Client
 *
 * HTTP/SSE client for communicating with the agent-backend server.
 * Supports both JSON and SSE streaming responses.
 */
import { randomUUID } from 'node:crypto'

import { IdempotencyKeyReusedError, IdempotentTurnDuplicateError } from '../core/errors'
import { AgentErrorCode, inferAgentErrorCodeFromMessage, isAgentErrorCode } from './agentErrors'
import { parseTurnOutcome, type TurnOutcome } from './cards'
import { CLI_SIGNABLE_FLAT_TOOLS, CLI_SIGNABLE_PREP_TOOLS, deriveToolOutputCandidate } from './toolOutputSigning'
import type {
  AuthTokenRequest,
  AuthTokenResponse,
  ConversationMessage,
  CreateConversationRequest,
  CreateConversationResponse,
  GetConversationRequest,
  GetConversationResponse,
  ListConversationsRequest,
  ListConversationsResponse,
  MessagesSinceResponse,
  ProtocolWarning,
  SendMessageRequest,
  SendMessageResponse,
  Suggestion,
  TxReadyPayload,
} from './types'

type JsonErrorBody = { error?: string; code?: string; conversation_id?: string; first_request_at?: string }

/** Generate a server-valid visible-ASCII key for one agent turn POST attempt.
 *
 *  Key LIFETIME belongs to the caller (AgentSession.processMessageLoop), NOT to
 *  this client — the default below only serves one-shot callers with no replay.
 *  Any caller that retries a POST (today: the withAuthRetry closure at
 *  session.ts, which invokes its request twice) MUST mint the key itself and
 *  pass it explicitly: the default re-evaluates per invocation, so relying on it
 *  inside a retry wrapper would re-key the replay and execute a second billable,
 *  signing-adjacent turn — the exact double-execution this feature prevents.
 *  sessionIdempotency.test.ts pins that contract. */
export function createTurnIdempotencyKey(): string {
  return randomUUID()
}

/** Default per-request timeout (ms) for agent-backend HTTP calls. Bounds a
 *  stalled TCP connection so a headless `vsig agent` run can't hang forever. */
const DEFAULT_HTTP_TIMEOUT_MS = 30_000
const DEFAULT_SSE_IDLE_TIMEOUT_MS = 180_000
/** Bounds on the backend-controlled frame types recorded in a PROTOCOL_DRIFT warning. */
const MAX_DRIFT_EVENT_TYPES = 10
const MAX_DRIFT_TYPE_LENGTH = 64

/** Resolve the per-request timeout from VULTISIG_HTTP_TIMEOUT_MS, falling back
 *  to the default. Non-positive / non-numeric values are ignored so a typo
 *  can't disable the timeout. Exported for direct unit testing of the contract. */
export function resolveHttpTimeoutMs(): number {
  const raw = process.env.VULTISIG_HTTP_TIMEOUT_MS
  if (raw === undefined || raw.trim() === '') return DEFAULT_HTTP_TIMEOUT_MS
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_HTTP_TIMEOUT_MS
}

/** Maximum time an established SSE stream may go without PROGRESS — a completed
 * data frame. Keep-alive comments do NOT extend it: both backends emit those
 * from a ticker that runs independently of turn progress (Go
 * `internal/api/message.go`, a `safego.Go` heartbeat writing `": ping"` every
 * 15s; Mastra `uiStream.ts` `withSseHeartbeat(resp, 15_000)`), so a backend
 * wedged in a model/MCP call heartbeats forever. A comment-reset clock therefore
 * bounds only a DEAD TRANSPORT, never the hung backend this deadline exists to
 * catch.
 *
 * The default is sized against the backend's own worst-case SILENT stretch, not
 * its heartbeat cadence: a single model call is bounded by `claudeRequestTimeout`
 * (90s, `agent.go`) and the swap builder is documented at "90s + 60s MCP timeout"
 * (`message.go`) — ~150s during which a healthy turn emits no frame at all. 180s
 * clears that with margin while still sitting below the backend's own
 * `agentTurnMaxDuration` (5min, `detach.go`), so a wedged turn is bounded here
 * rather than never. Raising this from the previous 60s is required by the
 * semantic change: 60s of no-frames was safe only because comments reset it. */
export function resolveSseIdleTimeoutMs(): number {
  const raw = process.env.VULTISIG_SSE_IDLE_TIMEOUT_MS
  if (raw === undefined || raw.trim() === '') return DEFAULT_SSE_IDLE_TIMEOUT_MS
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SSE_IDLE_TIMEOUT_MS
}

export class AgentStreamIdleTimeoutError extends Error {
  readonly code = AgentErrorCode.TIMEOUT

  constructor(readonly timeoutMs: number) {
    super(`SSE stream idle timeout after ${timeoutMs}ms without progress`)
    this.name = 'AgentStreamIdleTimeoutError'
  }
}

type StreamCallbacks = {
  onTextDelta?: (delta: string) => void
  // `ok` is set only on the terminal ('done') frame: false when the
  // tool's output payload is an error ({"status":"error"} / {"error"}),
  // true on a clean result, undefined when the stream carries no output
  // (older backends) so the consumer can fall back to its prior default.
  onToolProgress?: (tool: string, status: 'running' | 'done', label?: string, ok?: boolean) => void
  // Fired for `tool-input-available` whose `toolName` is in the client's
  // client-side tool registry (see `AgentClient.setClientSideToolNames`).
  // Identification is registry-based — mirroring the app's `toolUIRegistry` —
  // because the backend deliberately no longer sends a `clientExecuted`
  // discriminator flag ("clients identify client-side tools via their own
  // tool registries; the server must not add discriminator flags").
  // Client runs the tool and ships the result via recent_actions.
  // Sync-only: callers must dispatch async work themselves (push to a
  // promise queue) — keeps `void`'d call at the SSE boundary safe from
  // unhandled rejections.
  onClientSideToolCall?: (toolCallId: string, toolName: string, input: Record<string, unknown>) => void
  onTitle?: (title: string) => void
  onSuggestions?: (suggestions: Suggestion[]) => void
  // #927 Phase 2: a client-side signable candidate ENRICHED from a
  // `tool-output-available` frame — the SOLE signing source. Production emits the
  // signable payload here (`data-tx_ready` is a hollow `{typed_confirm}` marker
  // the CLI doesn't consume). `source` distinguishes a flat enrichment
  // (polymarket / build_custom_* / erc20_approve) from an `execute_*` prep
  // passthrough; both sign. The session buffers it into the executor.
  onToolOutputTx?: (payload: TxReadyPayload, toolName: string, source: 'flat' | 'prep') => void
  // Fired for the `data-balance_summary` SSE part the backend emits when the
  // client advertised "balance_summary" in supported_surfaces. Carries the raw
  // card envelope; the consumer validates + renders it. Replaces the legacy
  // verbatim-echo path where the card arrived as raw JSON in message content.
  onBalanceSummary?: (card: unknown) => void
  // Fired for the `data-turn_outcome` SSE part the backend emits at turn end when
  // the client advertised "turn_outcome" in supported_surfaces (a2a-02). Carries
  // the typed { kind, code?, detail? } discriminator so a headless caller can tell
  // success / block / refusal / error apart without parsing prose.
  onTurnOutcome?: (outcome: TurnOutcome) => void
  onMessage?: (msg: ConversationMessage) => void
  onError?: (error: string, code: AgentErrorCode) => void
}

type SSEPayload = Record<string, any>

// Map a v1 frame type to the legacy 'running' | 'done' lifecycle. The v1
// protocol never sends `status` on tool frames (see protocol_v1.go) so the
// client derives it from the frame type itself.
function v1StatusFromType(type: string | null): 'running' | 'done' | undefined {
  switch (type) {
    case 'tool-input-start':
    case 'tool-input-available':
    case 'tool-input-delta':
      return 'running'
    // Both terminal frames close the tool call. `tool-output-error` is the
    // backend's explicit failure terminal (`V1ToolOutputError`): without it the
    // call has no terminal frame at all, so the tool card stays 'running'
    // forever and the turn reports no failure — "which lets the LLM's same-turn
    // prose claim success even though no action ever ran" (protocol_v1.go).
    case 'tool-output-available':
    case 'tool-output-error':
      return 'done'
    default:
      return undefined
  }
}

/** An object payload signals failure if it has an error status or any
 *  top-level `error` key. Shared by the object path and the
 *  parsed-string path so a stringified payload is judged exactly like
 *  the object form (CodeRabbit #500: the string path was weaker). */
function isErrorPayloadObject(o: Record<string, unknown>): boolean {
  return o.status === 'error' || 'error' in o
}

/**
 * Derive real tool success from the terminal frame (fund-safety bug #B).
 * Returns false for an explicit `tool-output-error` frame or an output payload
 * that signals an error ({"status":"error"} / {"error":...} / stringified),
 * true on a clean result, and undefined when there's nothing to judge (not a
 * terminal frame, or no output — older backends) so the consumer keeps its
 * prior optimistic default. Extracted from handleSSEEvent to keep that
 * function under the cognitive-complexity budget.
 */
function deriveToolDoneOk(
  status: 'running' | 'done' | undefined,
  output: unknown,
  v1Type: string | null
): boolean | undefined {
  // A `tool-output-error` frame IS the failure signal. It carries `errorText`
  // and never `output`, so the payload heuristics below have nothing to judge
  // and would return undefined — which the consumer reads as the optimistic
  // `ok ?? true` default, i.e. it would report a FAILED tool as successful.
  // Decide from the frame type itself, before any payload inspection.
  if (v1Type === 'tool-output-error') return false
  if (status !== 'done' || output == null) return undefined
  if (typeof output === 'object') {
    return !isErrorPayloadObject(output as Record<string, unknown>)
  }
  if (typeof output === 'string') {
    const s = output.trim()
    if (/^error\b/i.test(s)) return false
    // Prefer parsing — a stringified payload must be judged by the same
    // rule as the object form, not a brittle substring match.
    try {
      const parsed = JSON.parse(s) as unknown
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return !isErrorPayloadObject(parsed as Record<string, unknown>)
      }
    } catch {
      // Non-JSON string — fall through to the tolerant pattern checks.
    }
    return !(/"status"\s*:\s*"error"/i.test(s) || /"error"\s*:/i.test(s))
  }
  return true
}

/**
 * Per-stream text-part accumulator. The V1 text protocol streams prose as
 * ordered parts — `text-start` / `text-delta` / `text-end`, each carrying an
 * `id` (`protocol_v1.go` V1TextStart/V1TextDelta) — and `text-replace` RETRACTS
 * one of those parts, supplying corrected text. Its contract is explicit: a
 * client "MUST locate the existing part with id==replaces and overwrite its
 * text, discarding the rejected text". Tracking parts by id is what lets that
 * overwrite land in place, mirroring the backend's own composition
 * (`unified_loop.go`), instead of appending a second contradictory bubble — or,
 * as before this fix, silently keeping the retracted text as the turn's answer.
 */
type TextParts = {
  byId: Map<string, string>
  order: string[]
  /** False once any `text-delta` arrived without an `id`. Such a stream cannot
   *  be recomposed from parts without dropping the un-keyed prose, so a
   *  `text-replace` against it is DEGRADED (logged, not applied) rather than
   *  half-applied. */
  allIdentified: boolean
}

function newTextParts(): TextParts {
  return { byId: new Map(), order: [], allIdentified: true }
}

function recomposeText(parts: TextParts): string {
  let out = ''
  for (const id of parts.order) out += parts.byId.get(id) ?? ''
  return out
}

function sseErrorToMessage(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (value instanceof Error) return value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function getV1Type(parsed: SSEPayload): string | null {
  return typeof parsed?.type === 'string' && parsed.type.length > 0 ? parsed.type : null
}

function getV1Data(parsed: SSEPayload, v1Type: string | null): SSEPayload | null {
  return v1Type?.startsWith('data-') ? parsed.data : null
}

function getToolInput(parsed: SSEPayload): Record<string, unknown> {
  const rawInput = parsed.input
  return rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
    ? (rawInput as Record<string, unknown>)
    : {}
}

export class AgentClient {
  private baseUrl: string
  private authToken: string | null = null
  private profile: string = ''
  verbose = false
  // Names of tools this client executes locally (client-side tools). The
  // backend's V1ToolInputAvailable frame carries NO discriminator flag —
  // "clients identify client-side tools via their own tool registries; the
  // server must not add discriminator flags". So the client mirrors the
  // app's `toolUIRegistry`: a `tool-input-available` frame triggers local
  // dispatch iff its `toolName` is in this set. Empty by default (no
  // client-side dispatch) until the session injects the registry.
  private clientSideToolNames: Set<string> = new Set()
  // Per-request timeout (ms) applied to every agent-backend fetch. Bounds a
  // stalled connection so a headless run can't hang indefinitely. Overridable
  // via the constructor (tests pass a tiny value) or VULTISIG_HTTP_TIMEOUT_MS.
  private readonly timeoutMs: number
  private readonly sseIdleTimeoutMs: number

  constructor(baseUrl: string, timeoutMs?: number, sseIdleTimeoutMs?: number) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.timeoutMs = timeoutMs ?? resolveHttpTimeoutMs()
    this.sseIdleTimeoutMs = sseIdleTimeoutMs ?? resolveSseIdleTimeoutMs()
  }

  /** Build the AbortSignal for a unary request: a fresh timeout, combined with
   *  an optional caller signal so caller-initiated cancellation still works. */
  private timeoutSignal(extra?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    return extra ? AbortSignal.any([extra, timeout]) : timeout
  }

  /** Translate an aborted-fetch rejection into a deterministic error. A
   *  caller-initiated abort is preserved verbatim (it's a deliberate cancel);
   *  a timeout abort (DOMException 'TimeoutError') becomes a clear, catchable
   *  Error so headless callers exit non-zero instead of hanging. */
  private asRequestError(err: unknown, extra?: AbortSignal): unknown {
    if (extra?.aborted) return err
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return new Error(`request timed out after ${this.timeoutMs}ms`)
    }
    return err
  }

  /** Read a successful JSON body, routing a body-read failure through the same
   *  normalization as the fetch() itself. If the backend sends headers then
   *  stalls the body, fetch() has already resolved and the timeout surfaces
   *  here during res.json() — so success paths keep the "request timed out
   *  after Nms" behavior end-to-end instead of leaking the raw abort. */
  private async readJson<T>(res: Response): Promise<T> {
    try {
      return (await res.json()) as T
    } catch (err) {
      throw this.asRequestError(err)
    }
  }

  /** Read a non-OK response's JSON error body. A genuinely malformed/empty body
   *  falls back to the status text so callers still get a useful message, but a
   *  timeout abort that strikes during the body read is re-thrown via
   *  asRequestError rather than masked as the statusText fallback — keeping the
   *  "request timed out after Nms" signal end-to-end on the error path too. */
  private async readErrorBody(res: Response): Promise<JsonErrorBody> {
    try {
      return (await res.json()) as JsonErrorBody
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw this.asRequestError(err)
      }
      return { error: res.statusText }
    }
  }

  setAuthToken(token: string): void {
    this.authToken = token
  }

  /** Inject the set of tool names this client executes locally. Identification
   *  of client-side tools is registry-based (mirroring the app's
   *  `toolUIRegistry`), not a wire flag — see `maybeEmitClientSideToolCall`. */
  setClientSideToolNames(names: Set<string>): void {
    this.clientSideToolNames = names
  }

  /** Set the billing-profile slug sent as X-Vultisig-Abe-Profile on every
   *  request. Empty falls back to the backend's default profile. */
  setProfile(profile: string): void {
    this.profile = profile
  }

  private profileHeader(): Record<string, string> {
    return this.profile ? { 'X-Vultisig-Abe-Profile': this.profile } : {}
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  async authenticate(req: AuthTokenRequest): Promise<AuthTokenResponse> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.profileHeader() },
        body: JSON.stringify(req),
        signal: this.timeoutSignal(),
      })
    } catch (err) {
      throw this.asRequestError(err)
    }
    if (!res.ok) {
      const body = await this.readErrorBody(res)
      throw new Error(`Auth failed (${res.status}): ${body.error || res.statusText}`)
    }
    const data = await this.readJson<AuthTokenResponse>(res)
    this.authToken = data.token
    return data
  }

  // ============================================================================
  // Health
  // ============================================================================

  async healthCheck(): Promise<boolean> {
    try {
      // A timeout aborts the fetch → caught here → reported unhealthy, so a
      // hung backend never blocks init indefinitely.
      const res = await fetch(`${this.baseUrl}/healthz`, { signal: this.timeoutSignal() })
      return res.ok
    } catch {
      return false
    }
  }

  // ============================================================================
  // Conversations
  // ============================================================================

  async createConversation(publicKey: string): Promise<CreateConversationResponse> {
    const req: CreateConversationRequest = { public_key: publicKey }
    return this.post<CreateConversationResponse>('/agent/conversations', req)
  }

  async listConversations(publicKey: string, skip = 0, take = 20): Promise<ListConversationsResponse> {
    const req: ListConversationsRequest = { public_key: publicKey, skip, take }
    return this.post<ListConversationsResponse>('/agent/conversations/list', req)
  }

  async getConversation(conversationId: string, publicKey: string): Promise<GetConversationResponse> {
    const req: GetConversationRequest = { public_key: publicKey }
    return this.post<GetConversationResponse>(`/agent/conversations/${conversationId}`, req)
  }

  async deleteConversation(conversationId: string, publicKey: string): Promise<void> {
    await this.delete(`/agent/conversations/${conversationId}`, {
      public_key: publicKey,
    })
  }

  // ============================================================================
  // Messages - JSON mode
  // ============================================================================

  async sendMessage(
    conversationId: string,
    req: SendMessageRequest,
    idempotencyKey: string = createTurnIdempotencyKey()
  ): Promise<SendMessageResponse> {
    return this.post<SendMessageResponse>(
      `/agent/conversations/${conversationId}/messages`,
      req,
      { 'Idempotency-Key': idempotencyKey },
      true
    )
  }

  /**
   * Reconnect-and-replay: fetch messages persisted to the conversation after
   * the supplied anchor. Used to recover a turn whose SSE stream dropped
   * mid-flight (the backend keeps processing on a detached context and
   * persists the assistant answer + any tx_ready card).
   *
   * First poll passes `{ since: <RFC3339> }` (bootstrap, anchored to the
   * server clock from X-Server-Now); subsequent polls round-trip the opaque
   * `{ cursor }` returned in the previous response so no tied row is skipped.
   * See agent-backend messages_since.go (issue #209 / PR #219).
   */
  async messagesSince(
    conversationId: string,
    anchor: { since?: string; cursor?: string }
  ): Promise<MessagesSinceResponse> {
    const qs = new URLSearchParams()
    // cursor wins on tie (matches the backend's parseMessagesSinceAnchor).
    if (anchor.cursor) qs.set('cursor', anchor.cursor)
    else if (anchor.since) qs.set('since', anchor.since)
    return this.get<MessagesSinceResponse>(`/agent/conversations/${conversationId}/messages/since?${qs.toString()}`)
  }

  // ============================================================================
  // Messages - SSE Streaming mode
  // ============================================================================

  async sendMessageStream(
    conversationId: string,
    req: SendMessageRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
    idempotencyKey: string = createTurnIdempotencyKey()
  ): Promise<SSEStreamResult> {
    // Bound the initial connect separately from the long-lived body read. A
    // dedicated controller fires the connect deadline and is cleared once
    // headers arrive; the read loop below uses a frame-idle deadline that healthy
    // keep-alive comments reset. The caller signal (Ctrl+C) remains combined in.
    const connectController = new AbortController()
    let connectTimedOut = false
    // `settled` flips the moment the fetch promise resolves/rejects. clearTimeout
    // (in the finally) already prevents the callback from running after that — JS
    // is single-threaded and the finally drains as a microtask before the next
    // timers phase — but the guard makes a late/queued firing a definitive no-op,
    // so the connect deadline can never abort the live SSE body read.
    let settled = false
    const connectTimer = setTimeout(() => {
      if (settled) return
      connectTimedOut = true
      connectController.abort()
    }, this.timeoutMs)
    const combinedSignal = signal ? AbortSignal.any([signal, connectController.signal]) : connectController.signal

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/agent/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'Idempotency-Key': idempotencyKey,
          ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
          ...this.profileHeader(),
        },
        body: JSON.stringify(req),
        signal: combinedSignal,
      })
    } catch (err) {
      // A caller abort during connect is a deliberate cancel — re-throw as-is.
      // Our own connect-deadline abort becomes a clear timeout error.
      if (connectTimedOut && !signal?.aborted) {
        throw new Error(`request timed out after ${this.timeoutMs}ms`)
      }
      throw err
    } finally {
      // Headers received (or fetch failed) — stop the connect deadline. The body
      // is bounded independently by the frame-idle deadline below.
      settled = true
      clearTimeout(connectTimer)
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as JsonErrorBody
      this.throwMessageError(res.status, res.statusText, body)
      throw new Error(`Message failed (${res.status}): ${body.error || res.statusText}`)
    }

    if (!res.body) {
      throw new Error('No response body for SSE stream')
    }

    const result: SSEStreamResult = {
      fullText: '',
      suggestions: [],
      message: null,
      finished: false,
      disconnected: false,
      protocolWarnings: [],
      // A-C2 contract: the backend stamps server-side wall-clock (epoch ms) on
      // the SSE response headers before the first chunk, so the recovery poll
      // anchors /messages/since to the server clock instead of Date.now()
      // (eliminates NTP-skew-induced poll swallowing). See message.go.
      serverNow: res.headers.get('X-Server-Now'),
    }

    // Per-stream map: v1 tool-output-available frames omit toolName (see
    // protocol_v1.go V1ToolOutputAvailable) — remember the name from the
    // earlier tool-input-start/available frame keyed by toolCallId so the
    // terminal 'done' callback still carries the tool name.
    const toolNameByCallId = new Map<string, string>()

    // Ordered text parts, so a `text-replace` can overwrite what it retracts.
    const textParts = newTextParts()

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let currentEvent = ''
    let currentData = ''
    let lastFrameAt = Date.now()

    /** Strip optional single leading space from an SSE field value per spec. */
    const stripLeadingSpace = (v: string): string => (v.length > 0 && v[0] === ' ' ? v.slice(1) : v)

    /**
     * Returns true only when the line completed a real data frame — i.e. the
     * backend made PROGRESS. That is the sole signal allowed to defer the idle
     * deadline. Keep-alive comments and blank separators return false: they
     * prove the TRANSPORT is alive (and are still consumed normally, so the
     * connection is never torn down for carrying them), but they say nothing
     * about whether the agent loop is advancing, because both backends emit
     * them from progress-independent tickers.
     */
    const processLine = (raw: string): boolean => {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      if (line.startsWith('event:')) {
        currentEvent = stripLeadingSpace(line.slice(6)).trim()
      } else if (line.startsWith('data:')) {
        currentData += (currentData ? '\n' : '') + stripLeadingSpace(line.slice(5))
      } else if (line === '') {
        // Empty line = end of event
        const completedFrame = currentData.length > 0
        if (currentData) {
          // SSE spec: default event type is "message" when no event: field is present
          this.handleSSEEvent(currentEvent || 'message', currentData, result, callbacks, toolNameByCallId, textParts)
        }
        currentEvent = ''
        currentData = ''
        return completedFrame
      }
      // SSE comments (`:` keep-alive pings), unknown fields (id:, retry:, etc.)
      // and blank separators are consumed but are NOT progress.
      // Bare \r line endings are unsupported (only \n and \r\n).
      return false
    }

    try {
      while (true) {
        const idleRemaining = this.sseIdleTimeoutMs - (Date.now() - lastFrameAt)
        const { done, value } = await this.readWithIdleDeadline(reader, idleRemaining)

        buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

        // Parse SSE events from buffer
        const lines = buffer.split('\n')
        // Keep incomplete last line between reads; on done, preserve it for final processing
        const trailing = lines.pop() ?? ''
        buffer = done ? '' : trailing

        for (const rawLine of lines) {
          if (processLine(rawLine)) lastFrameAt = Date.now()
        }

        if (done) {
          // Process any trailing content that wasn't newline-terminated
          if (trailing && processLine(trailing)) lastFrameAt = Date.now()
          // Flush any pending event (stream ended without final blank line)
          if (currentData) {
            this.handleSSEEvent(currentEvent || 'message', currentData, result, callbacks, toolNameByCallId, textParts)
          }
          break
        }
      }
    } catch (err) {
      if (err instanceof AgentStreamIdleTimeoutError) {
        await reader.cancel(err).catch(() => {})
        throw err
      }
      // A user-initiated cancel (Ctrl+C → AbortController.abort()) is a
      // deliberate stop, not a dropped connection — re-throw so the caller
      // surfaces "[cancelled]" and does NOT try to recover the turn.
      if (signal?.aborted) {
        throw err
      }
      // Any other read failure is a mid-turn transport drop. The backend keeps
      // processing on a detached context and persists the answer (+ tx_ready),
      // so flag the partial result and let the caller poll /messages/since to
      // recover what we missed instead of losing the turn outright.
      result.disconnected = true
      if (this.verbose) process.stderr.write(`[SSE] stream dropped mid-turn: ${sseErrorToMessage(err)}\n`)
    } finally {
      reader.releaseLock()
    }

    return result
  }

  private readWithIdleDeadline(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    remainingMs: number
  ): ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']> {
    if (remainingMs <= 0) return Promise.reject(new AgentStreamIdleTimeoutError(this.sseIdleTimeoutMs))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new AgentStreamIdleTimeoutError(this.sseIdleTimeoutMs)), remainingMs)
      reader.read().then(
        value => {
          clearTimeout(timer)
          resolve(value)
        },
        err => {
          clearTimeout(timer)
          reject(err)
        }
      )
    })
  }

  private handleSSEEvent(
    event: string,
    data: string,
    result: SSEStreamResult,
    callbacks: StreamCallbacks,
    toolNameByCallId: Map<string, string>,
    textParts: TextParts
  ): void {
    try {
      const parsed = JSON.parse(data)

      // AI SDK v5 streaming: event type is carried in the JSON `type` field
      // rather than in an `event:` SSE header. Prefer that when present so the
      // new backend (v-pxuw) and the legacy event-header tests both work.
      const v1Type = getV1Type(parsed)
      const routingEvent = v1Type ? this.mapV1EventType(v1Type) : event

      // V1 custom-data events carry their payload under `.data`; legacy events
      // carry it inline. Normalise so case handlers see a single shape.
      const v1Data = getV1Data(parsed, v1Type)

      switch (routingEvent) {
        case 'text_delta':
          this.handleTextDelta(parsed, result, callbacks, textParts)
          break
        case 'text_replace':
          this.handleTextReplace(parsed, result, textParts)
          break
        case 'tool_progress':
          this.handleToolProgress(parsed, data, callbacks, toolNameByCallId, v1Type)
          break
        case 'title': {
          const title = v1Data?.title ?? parsed.title
          if (typeof title === 'string') callbacks.onTitle?.(title)
          break
        }
        case 'suggestions': {
          const suggestions = v1Data?.suggestions ?? parsed.suggestions ?? []
          result.suggestions.push(...suggestions)
          callbacks.onSuggestions?.(suggestions)
          break
        }
        case 'balance_summary': {
          // v1 custom-data part: envelope under `.data`. Legacy event-header
          // form would carry it inline, so accept both shapes.
          const card = v1Data ?? parsed.data ?? parsed
          callbacks.onBalanceSummary?.(card)
          break
        }
        case 'turn_outcome': {
          // a2a-02: typed turn-outcome discriminator (envelope under `.data`).
          // parseTurnOutcome drops a malformed payload so it can never flip an
          // exit code — the caller keeps its default classification instead.
          const outcome = parseTurnOutcome(v1Data ?? parsed.data ?? parsed)
          if (outcome) callbacks.onTurnOutcome?.(outcome)
          break
        }
        case 'message': {
          const msg = v1Data?.message ?? parsed.message ?? parsed
          result.message = msg
          callbacks.onMessage?.(result.message!)
          break
        }
        case 'error': {
          this.handleErrorEvent(parsed, callbacks)
          break
        }
        case 'done':
          // Terminal finish frame — the turn completed cleanly, no recovery needed.
          result.finished = true
          break
        case 'ignore':
          break
        case 'tolerated':
          // An unknown `data-*` card. The backend evolves these forward-compatibly
          // and emits some from a dynamic site, so this is expected traffic
          // against a newer backend, not a defect: visible to a developer under
          // --verbose, invisible to machine callers.
          if (this.verbose) process.stderr.write(`[SSE] tolerated unknown data frame: ${v1Type}\n`)
          break
        default:
          this.recordProtocolDrift(v1Type ?? event, result)
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        if (this.verbose) process.stderr.write(`[SSE] skipping malformed JSON: ${data.slice(0, 200)}\n`)
      } else {
        throw e
      }
    }
  }

  // PROTOCOL_DRIFT is a DEBUG signal, not a machine-consumer contract, so it
  // rides the result envelope only under --verbose. The backend deliberately
  // evolves the wire forward-compatibly; warning by default therefore fires on
  // healthy turns against a newer backend, and a drift detector that fires on
  // ~every healthy turn is one machine consumers learn to filter out — worse
  // than not shipping it. Unknown `data-*` cards never reach here at all (they
  // route to 'tolerated'); this is now only for genuinely unexpected
  // protocol-level frames.
  //
  // `type` is backend-controlled wire content, so it stays bounded on both axes:
  // a malformed backend emitting many long, distinct types would otherwise grow
  // `eventTypes` without limit and re-join it on every frame. `count` stays
  // exact — only the type list is capped.
  private recordProtocolDrift(rawType: string, result: SSEStreamResult): void {
    if (!this.verbose) return
    const type = rawType.length > MAX_DRIFT_TYPE_LENGTH ? `${rawType.slice(0, MAX_DRIFT_TYPE_LENGTH)}…` : rawType
    process.stderr.write(`[SSE] unknown frame type: ${type}\n`)
    let warning = result.protocolWarnings[0]
    if (!warning) {
      warning = { code: 'PROTOCOL_DRIFT', message: '', count: 0, eventTypes: [] }
      result.protocolWarnings.push(warning)
    }
    warning.count += 1
    if (!warning.eventTypes.includes(type) && warning.eventTypes.length < MAX_DRIFT_EVENT_TYPES) {
      warning.eventTypes.push(type)
    }
    const noun = warning.count === 1 ? 'frame' : 'frames'
    warning.message = `Ignored ${warning.count} unknown SSE ${noun}: ${warning.eventTypes.join(', ')}`
  }

  private handleTextDelta(
    parsed: SSEPayload,
    result: SSEStreamResult,
    callbacks: StreamCallbacks,
    textParts: TextParts
  ): void {
    if (typeof parsed.delta !== 'string') return
    // Live append is unchanged — the TTY streams as it arrives. The part map is
    // kept in parallel purely so a later `text-replace` can rewrite `fullText`
    // (the turn's authoritative answer, see session.ts `responseText`).
    result.fullText += parsed.delta
    callbacks.onTextDelta?.(parsed.delta)

    const id = typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : null
    if (!id) {
      textParts.allIdentified = false
      return
    }
    if (!textParts.byId.has(id)) textParts.order.push(id)
    textParts.byId.set(id, (textParts.byId.get(id) ?? '') + parsed.delta)
  }

  /**
   * Apply a `text-replace`: overwrite the retracted part in place and recompose
   * `fullText` from the ordered parts. This is the truthful-outcome case — the
   * backend emits this frame precisely when it has decided the streamed prose is
   * WRONG, so keeping the retracted text means `agent ask` answers with the
   * claim the backend just withdrew.
   *
   * The live TTY has already printed the retracted text and cannot unprint it,
   * but the corrected `fullText` still lands: session.ts renders the final
   * assistant message from it after the stream, and it is the `response` field
   * of `agent ask --output json`.
   */
  private handleTextReplace(parsed: SSEPayload, result: SSEStreamResult, textParts: TextParts): void {
    const replaces = typeof parsed.replaces === 'string' ? parsed.replaces : ''
    const text = typeof parsed.text === 'string' ? parsed.text : null
    // Degrade safely rather than half-apply. Recomposing a stream that carried
    // un-keyed deltas would DROP that prose, and replacing a part we never saw
    // would invent ordering — both are worse than leaving the text as streamed,
    // which is at least something the backend actually said.
    if (text === null || !replaces || !textParts.allIdentified || !textParts.byId.has(replaces)) {
      if (this.verbose) {
        process.stderr.write(
          `[SSE] text-replace not applied (replaces=${replaces || '<missing>'}); text left as streamed\n`
        )
      }
      return
    }
    textParts.byId.set(replaces, text)
    result.fullText = recomposeText(textParts)
    if (this.verbose) process.stderr.write(`[SSE] text-replace applied to part ${replaces}\n`)
  }

  private handleToolProgress(
    parsed: SSEPayload,
    data: string,
    callbacks: StreamCallbacks,
    toolNameByCallId: Map<string, string>,
    v1Type: string | null
  ): void {
    if (this.verbose) process.stderr.write(`[SSE:tool_progress] raw: ${data.slice(0, 1000)}\n`)

    const status = (parsed.status as 'running' | 'done' | undefined) ?? v1StatusFromType(v1Type)
    const callId = typeof parsed.toolCallId === 'string' ? parsed.toolCallId : null
    const rawInlineName = parsed.tool ?? parsed.toolName
    const inlineName = typeof rawInlineName === 'string' && rawInlineName.length > 0 ? rawInlineName : undefined
    if (callId && inlineName) toolNameByCallId.set(callId, inlineName)

    const toolName = inlineName ?? (callId ? toolNameByCallId.get(callId) : undefined)
    const label = typeof parsed.label === 'string' ? parsed.label : undefined
    this.maybeEmitClientSideToolCall(parsed, callbacks, v1Type, callId, toolName)

    const ok = deriveToolDoneOk(status, parsed.output, v1Type)
    if (status && toolName) callbacks.onToolProgress?.(toolName, status, label, ok)
    this.maybeSignToolOutput(status, toolName, parsed.output, callbacks, v1Type)
    if (status === 'done' && callId) toolNameByCallId.delete(callId)
  }

  /**
   * #927 Phase 2: derive a client-side signable candidate from a signable tool's
   * raw `tool-output-available` output — the same envelope mobile reads — and
   * hand it to the session via `onToolOutputTx` as the SOLE signing source
   * (production emits the payload here; `data-tx_ready` is a hollow marker). The
   * bridge guards against non-tx results (`no_op` / `insufficient_*` / errors)
   * and phantom-card prep envelopes so those never reach the signer. Zero backend
   * change.
   */
  private maybeSignToolOutput(
    status: 'running' | 'done' | undefined,
    toolName: string | undefined,
    output: unknown,
    callbacks: StreamCallbacks,
    v1Type: string | null
  ): void {
    // `tool-output-error` is a terminal ('done') frame, so it reaches here — but
    // it reports a tool that FAILED and carries no output. deriveToolOutputCandidate
    // would return null for its absent payload anyway; this guard is explicit so
    // the fail-closed property is stated at the signing boundary rather than
    // resting on a null-check three calls away.
    if (v1Type === 'tool-output-error') return
    if (status !== 'done' || !toolName || !callbacks.onToolOutputTx) return
    if (!CLI_SIGNABLE_FLAT_TOOLS.has(toolName) && !CLI_SIGNABLE_PREP_TOOLS.has(toolName)) return
    const candidate = deriveToolOutputCandidate(toolName, output)
    if (!candidate) return
    if (this.verbose)
      process.stderr.write(`[SSE:tool_output] ${toolName} → onToolOutputTx (${candidate.source} candidate)\n`)
    callbacks.onToolOutputTx(candidate.payload, toolName, candidate.source)
  }

  private maybeEmitClientSideToolCall(
    parsed: SSEPayload,
    callbacks: StreamCallbacks,
    v1Type: string | null,
    callId: string | null,
    toolName?: string
  ): void {
    // Registry-based identification (mirrors the app's toolUIRegistry): a
    // `tool-input-available` frame is dispatched locally iff its toolName is
    // in this client's client-side tool registry. The backend sends no
    // `clientExecuted` discriminator (it was removed) — keying on a wire flag
    // here is what left these tools dead, so we key on the registry instead.
    // Non-registry tools (server-side / MCP) fall through untouched.
    if (
      v1Type !== 'tool-input-available' ||
      !callId ||
      !toolName ||
      !this.clientSideToolNames.has(toolName) ||
      !callbacks.onClientSideToolCall
    ) {
      return
    }

    callbacks.onClientSideToolCall(callId, toolName, getToolInput(parsed))
  }

  private handleErrorEvent(parsed: SSEPayload, callbacks: StreamCallbacks): void {
    const errorText = typeof parsed.errorText === 'string' ? parsed.errorText : parsed.error
    const msg = sseErrorToMessage(errorText)
    const codeFromBackend =
      typeof parsed.code === 'string' && isAgentErrorCode(parsed.code)
        ? parsed.code
        : inferAgentErrorCodeFromMessage(msg)
    callbacks.onError?.(msg, codeFromBackend)
  }

  // Maps a V1 `type` field to the event bucket used by handleSSEEvent's switch.
  //
  // This enumerates what the CLI HANDLES, not what the backends can emit — the
  // inverse of the original design. Enumerating the latter is unwinnable by
  // construction: the frames are produced by two independently-evolving backends
  // including a DYNAMIC site, `V1Data(streamSurface, …)` (agent.go) over the
  // mutable `genericCardSurfaces` map (response_validator.go), and three
  // successive enumeration passes each found types the last had missed. The
  // backend's V1 contract also treats unknown data kinds as forward-compatible
  // by design (`v1_wire_schema_test.go`), so a `data-*` kind this CLI has no
  // surface for is simply a card it does not render — not drift. Those fall to
  // `default` → 'tolerated' and stay quiet; no list here pretends to be complete.
  //
  // What must be explicit instead is the small set of KNOWN-DANGEROUS frames —
  // the ones whose omission is not a display gap but a false turn result:
  //   • `tool-output-error` — the tool-failure terminal. Ignored, a failed tool
  //     never closes and the turn reports success.
  //   • `text-replace` — retracts prose the backend has decided is wrong.
  //     Ignored, the RETRACTED text stays as the turn's answer.
  // `data-tx_ready` routes to 'ignore' deliberately: #927 Phase 2 signs purely
  // from `tool-output-available`, and production emits `data-tx_ready` only as a
  // hollow `{typed_confirm}` marker the CLI doesn't use.
  private mapV1EventType(type: string): string {
    switch (type) {
      case 'text-delta':
        return 'text_delta'
      case 'text-replace':
        return 'text_replace'
      case 'tool-input-start':
      case 'tool-input-available':
      case 'tool-input-delta':
      case 'tool-output-available':
      case 'tool-output-error':
        return 'tool_progress'
      case 'data-title':
        return 'title'
      case 'data-suggestions':
        return 'suggestions'
      case 'data-balance_summary':
        return 'balance_summary'
      case 'data-turn_outcome':
        return 'turn_outcome'
      case 'data-message':
        return 'message'
      case 'error':
        return 'error'
      case 'finish':
        return 'done'
      // Frame-level lifecycle the CLI has no surface for. These are NOT data
      // cards, so they can't ride the forward-compatible `data-*` tolerance —
      // they must be named to stay quiet.
      case 'start':
      case 'start-step':
      case 'text-start':
      case 'text-end':
      case 'finish-step':
        return 'ignore'
      // Known per-turn telemetry cards. These WOULD be tolerated by the
      // `data-*` rule below, so naming them is not load-bearing — unlike the old
      // design, forgetting one costs a --verbose log line, not a PROTOCOL_DRIFT
      // stamped on a healthy turn. They are named only because they arrive on
      // essentially every turn and calling them "unknown" in the verbose log
      // would be both noisy and untrue.
      case 'data-tokens':
      case 'data-usage':
      case 'data-tx_ready':
        return 'ignore'
      default:
        // Unknown `data-*` card → tolerated by the backend's forward-compat
        // contract. Anything else is a protocol-level frame we genuinely did not
        // expect → drift (verbose only; see recordProtocolDrift).
        return type.startsWith('data-') ? 'tolerated' : 'unknown'
    }
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private async get<T>(path: string): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: {
          ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
          ...this.profileHeader(),
        },
        // ok: unary, body is always small — the timeout covers the full
        // request including the body read, but these JSON responses are tiny.
        signal: this.timeoutSignal(),
      })
    } catch (err) {
      throw this.asRequestError(err)
    }

    if (!res.ok) {
      const errorBody = await this.readErrorBody(res)
      throw new Error(`Request failed (${res.status}): ${errorBody.error || res.statusText}`)
    }

    return this.readJson<T>(res)
  }

  private async post<T>(
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
    isMessageTurn = false
  ): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...extraHeaders,
          ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
          ...this.profileHeader(),
        },
        body: JSON.stringify(body),
        // ok: unary, body is always small — the timeout covers the full
        // request including the body read, but these JSON responses are tiny.
        signal: this.timeoutSignal(),
      })
    } catch (err) {
      throw this.asRequestError(err)
    }

    if (!res.ok) {
      const errorBody = await this.readErrorBody(res)
      if (isMessageTurn) this.throwMessageError(res.status, res.statusText, errorBody)
      throw new Error(`Request failed (${res.status}): ${errorBody.error || res.statusText}`)
    }

    return this.readJson<T>(res)
  }

  /** Map the backend's durable keyed-turn 409s into the CLI's typed errors.
   * Other message failures keep their existing wire and error behavior unchanged.
   *
   * The two keyed 409s mean OPPOSITE things and must not collapse into one code:
   *   - idempotent_turn_duplicate: same key + same body. The turn WAS accepted and
   *     its result is persisted — do NOT retry, go read the conversation (exit 14).
   *   - idempotency_key_reused: same key + a DIFFERENT body. The claim belongs to
   *     some other request; THIS operation never ran and nothing was persisted for
   *     it. Telling the caller to "inspect the conversation for its result" would
   *     point at a different request's result and silently drop this intent. It is
   *     a caller protocol bug — nothing executed — so it maps to INVALID_INPUT and
   *     the remediation is a fresh key, the opposite of duplicate's "don't retry".
   * The CLI mints a fresh UUID per attempt, so reuse is unreachable from here today
   * — but sendMessage/sendMessageStream take a caller-supplied key, so the contract
   * is honored rather than assumed. */
  private throwMessageError(status: number, statusText: string, body: JsonErrorBody): void {
    if (status !== 409) return
    if (body.code === 'idempotent_turn_duplicate') {
      throw new IdempotentTurnDuplicateError(
        body.error || statusText || 'This keyed turn was already accepted',
        body.conversation_id,
        body.first_request_at
      )
    }
    if (body.code === 'idempotency_key_reused') {
      throw new IdempotencyKeyReusedError(
        body.error || statusText || 'This idempotency key was already used for a different request body',
        body.conversation_id,
        body.first_request_at
      )
    }
  }

  private async delete(path: string, body: unknown): Promise<void> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
          ...this.profileHeader(),
        },
        body: JSON.stringify(body),
        signal: this.timeoutSignal(),
      })
    } catch (err) {
      throw this.asRequestError(err)
    }

    if (!res.ok) {
      const errorBody = await this.readErrorBody(res)
      throw new Error(`Delete failed (${res.status}): ${errorBody.error || res.statusText}`)
    }
  }
}

export type SSEStreamResult = {
  fullText: string
  suggestions: Suggestion[]
  message: ConversationMessage | null
  /** True once the terminal finish/done frame was seen — the turn completed
   *  cleanly and no /messages/since recovery is required. */
  finished: boolean
  /** True when the SSE read loop ended on a transport error mid-turn (a
   *  dropped connection, not a user abort). Signals the caller to recover the
   *  persisted answer via /messages/since. */
  disconnected: boolean
  /** Non-fatal unknown wire frames observed during this stream. */
  protocolWarnings: ProtocolWarning[]
  /** X-Server-Now (epoch millis as a string) captured from the SSE response
   *  headers — the server-clock bootstrap anchor for the recovery poll.
   *  null when the header is absent (older backend). */
  serverNow: string | null
}
