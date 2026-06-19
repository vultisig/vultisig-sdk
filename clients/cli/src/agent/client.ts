/**
 * Agent Backend Client
 *
 * HTTP/SSE client for communicating with the agent-backend server.
 * Supports both JSON and SSE streaming responses.
 */
import { AgentErrorCode, inferAgentErrorCodeFromMessage, isAgentErrorCode } from './agentErrors'
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
  SendMessageRequest,
  SendMessageResponse,
  Suggestion,
  TxReadyPayload,
} from './types'

type JsonErrorBody = { error?: string; code?: string }

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
  onTxReady?: (tx: TxReadyPayload) => void
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
    case 'tool-output-available':
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
 * Derive real tool success from the terminal-frame output payload
 * (fund-safety bug #B). Returns false when the payload signals an error
 * ({"status":"error"} / {"error":...} / stringified), true on a clean
 * result, and undefined when there's nothing to judge (not the 'done'
 * frame, or no output — older backends) so the consumer keeps its prior
 * optimistic default. Extracted from handleSSEEvent to keep that
 * function under the cognitive-complexity budget.
 */
function deriveToolDoneOk(status: 'running' | 'done' | undefined, output: unknown): boolean | undefined {
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

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
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
    const res = await fetch(`${this.baseUrl}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.profileHeader() },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as JsonErrorBody
      throw new Error(`Auth failed (${res.status}): ${body.error || res.statusText}`)
    }
    const data = (await res.json()) as AuthTokenResponse
    this.authToken = data.token
    return data
  }

  // ============================================================================
  // Health
  // ============================================================================

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/healthz`)
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

  async sendMessage(conversationId: string, req: SendMessageRequest): Promise<SendMessageResponse> {
    return this.post<SendMessageResponse>(`/agent/conversations/${conversationId}/messages`, req)
  }

  // ============================================================================
  // Messages - SSE Streaming mode
  // ============================================================================

  async sendMessageStream(
    conversationId: string,
    req: SendMessageRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<SSEStreamResult> {
    const res = await fetch(`${this.baseUrl}/agent/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
        ...this.profileHeader(),
      },
      body: JSON.stringify(req),
      signal,
    })

    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as JsonErrorBody
      throw new Error(`Message failed (${res.status}): ${body.error || res.statusText}`)
    }

    if (!res.body) {
      throw new Error('No response body for SSE stream')
    }

    const result: SSEStreamResult = {
      fullText: '',
      suggestions: [],
      transactions: [],
      message: null,
    }

    // Per-stream map: v1 tool-output-available frames omit toolName (see
    // protocol_v1.go V1ToolOutputAvailable) — remember the name from the
    // earlier tool-input-start/available frame keyed by toolCallId so the
    // terminal 'done' callback still carries the tool name.
    const toolNameByCallId = new Map<string, string>()

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let currentEvent = ''
    let currentData = ''

    /** Strip optional single leading space from an SSE field value per spec. */
    const stripLeadingSpace = (v: string): string => (v.length > 0 && v[0] === ' ' ? v.slice(1) : v)

    const processLine = (raw: string): void => {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      if (line.startsWith('event:')) {
        currentEvent = stripLeadingSpace(line.slice(6)).trim()
      } else if (line.startsWith('data:')) {
        currentData += (currentData ? '\n' : '') + stripLeadingSpace(line.slice(5))
      } else if (line === '') {
        // Empty line = end of event
        if (currentData) {
          // SSE spec: default event type is "message" when no event: field is present
          this.handleSSEEvent(currentEvent || 'message', currentData, result, callbacks, toolNameByCallId)
        }
        currentEvent = ''
        currentData = ''
      } else if (line[0] === ':') {
        // SSE comment (keep-alive ping) - ignore
      }
      // Unknown fields (id:, retry:, etc.) silently ignored - no reconnection support.
      // Bare \r line endings are unsupported (only \n and \r\n).
    }

    try {
      while (true) {
        const { done, value } = await reader.read()

        buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

        // Parse SSE events from buffer
        const lines = buffer.split('\n')
        // Keep incomplete last line between reads; on done, preserve it for final processing
        const trailing = lines.pop() ?? ''
        buffer = done ? '' : trailing

        for (const rawLine of lines) {
          processLine(rawLine)
        }

        if (done) {
          // Process any trailing content that wasn't newline-terminated
          if (trailing) processLine(trailing)
          // Flush any pending event (stream ended without final blank line)
          if (currentData) {
            this.handleSSEEvent(currentEvent || 'message', currentData, result, callbacks, toolNameByCallId)
          }
          break
        }
      }
    } finally {
      reader.releaseLock()
    }

    return result
  }

  private handleSSEEvent(
    event: string,
    data: string,
    result: SSEStreamResult,
    callbacks: StreamCallbacks,
    toolNameByCallId: Map<string, string>
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
          this.handleTextDelta(parsed, result, callbacks)
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
        case 'tx_ready':
          if (this.verbose) process.stderr.write(`[SSE:tx_ready] raw: ${data.slice(0, 2000)}\n`)
          {
            const txReady = (v1Data ?? parsed) as TxReadyPayload
            result.transactions.push(txReady)
            callbacks.onTxReady?.(txReady)
          }
          break
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
          // Stream complete
          break
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        if (this.verbose) process.stderr.write(`[SSE] skipping malformed JSON: ${data.slice(0, 200)}\n`)
      } else {
        throw e
      }
    }
  }

  private handleTextDelta(parsed: SSEPayload, result: SSEStreamResult, callbacks: StreamCallbacks): void {
    if (typeof parsed.delta !== 'string') return
    result.fullText += parsed.delta
    callbacks.onTextDelta?.(parsed.delta)
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

    const ok = deriveToolDoneOk(status, parsed.output)
    if (status && toolName) callbacks.onToolProgress?.(toolName, status, label, ok)
    if (status === 'done' && callId) toolNameByCallId.delete(callId)
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

  // Maps a V1 `type` field to the legacy event bucket used by handleSSEEvent's
  // switch. Frame-level types (start, text-start, text-end, finish-step) and
  // non-critical telemetry (data-tokens, data-usage, data-confirmation) route
  // to 'ignore' which is a no-op.
  private mapV1EventType(type: string): string {
    switch (type) {
      case 'text-delta':
        return 'text_delta'
      case 'tool-input-start':
      case 'tool-input-available':
      case 'tool-input-delta':
      case 'tool-output-available':
        return 'tool_progress'
      case 'data-title':
        return 'title'
      case 'data-suggestions':
        return 'suggestions'
      case 'data-tx_ready':
        return 'tx_ready'
      case 'data-message':
        return 'message'
      case 'error':
        return 'error'
      case 'finish':
        return 'done'
      default:
        return 'ignore'
    }
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
        ...this.profileHeader(),
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errorBody = (await res.json().catch(() => ({ error: res.statusText }))) as JsonErrorBody
      throw new Error(`Request failed (${res.status}): ${errorBody.error || res.statusText}`)
    }

    return (await res.json()) as T
  }

  private async delete(path: string, body: unknown): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
        ...this.profileHeader(),
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errorBody = (await res.json().catch(() => ({ error: res.statusText }))) as JsonErrorBody
      throw new Error(`Delete failed (${res.status}): ${errorBody.error || res.statusText}`)
    }
  }
}

export type SSEStreamResult = {
  fullText: string
  suggestions: Suggestion[]
  transactions: TxReadyPayload[]
  message: ConversationMessage | null
}
