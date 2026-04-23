/**
 * Agent Backend Client
 *
 * HTTP/SSE client for communicating with the agent-backend server.
 * Supports both JSON and SSE streaming responses.
 */
import { AgentErrorCode, inferAgentErrorCodeFromMessage, isAgentErrorCode } from './agentErrors'
import type {
  Action,
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

export class AgentClient {
  private baseUrl: string
  private authToken: string | null = null
  verbose = false

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  setAuthToken(token: string): void {
    this.authToken = token
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  async authenticate(req: AuthTokenRequest): Promise<AuthTokenResponse> {
    const res = await fetch(`${this.baseUrl}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    callbacks: {
      onTextDelta?: (delta: string) => void
      onToolProgress?: (tool: string, status: 'running' | 'done', label?: string) => void
      /**
       * Fired when a `tool-input-available` event carries `clientExecuted: true`.
       * The client is expected to execute the tool and ship the result back
       * via `context.recent_actions` on the next outbound request. See
       * session.ts for the dispatch registry and queue.
       */
      onClientSideToolCall?: (
        toolCallId: string,
        toolName: string,
        input: Record<string, unknown>
      ) => void | Promise<void>
      onTitle?: (title: string) => void
      onActions?: (actions: Action[]) => void
      onSuggestions?: (suggestions: Suggestion[]) => void
      onTxReady?: (tx: TxReadyPayload) => void
      onMessage?: (msg: ConversationMessage) => void
      onError?: (error: string, code: AgentErrorCode) => void
    },
    signal?: AbortSignal
  ): Promise<SSEStreamResult> {
    const res = await fetch(`${this.baseUrl}/agent/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
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
      actions: [],
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
    callbacks: {
      onTextDelta?: (delta: string) => void
      onToolProgress?: (tool: string, status: 'running' | 'done', label?: string) => void
      /**
       * Fired when a `tool-input-available` event carries `clientExecuted: true`.
       * The client is expected to execute the tool and ship the result back
       * via `context.recent_actions` on the next outbound request. See
       * session.ts for the dispatch registry and queue.
       */
      onClientSideToolCall?: (
        toolCallId: string,
        toolName: string,
        input: Record<string, unknown>
      ) => void | Promise<void>
      onTitle?: (title: string) => void
      onActions?: (actions: Action[]) => void
      onSuggestions?: (suggestions: Suggestion[]) => void
      onTxReady?: (tx: TxReadyPayload) => void
      onMessage?: (msg: ConversationMessage) => void
      onError?: (error: string, code: AgentErrorCode) => void
    },
    toolNameByCallId: Map<string, string>
  ): void {
    try {
      const parsed = JSON.parse(data)

      // AI SDK v5 streaming: event type is carried in the JSON `type` field
      // rather than in an `event:` SSE header. Prefer that when present so the
      // new backend (v-pxuw) and the legacy event-header tests both work.
      const v1Type = typeof parsed?.type === 'string' && parsed.type.length > 0 ? parsed.type : null
      const routingEvent = v1Type ? this.mapV1EventType(v1Type) : event

      // V1 custom-data events carry their payload under `.data`; legacy events
      // carry it inline. Normalise so case handlers see a single shape.
      const v1Data = typeof parsed?.type === 'string' && parsed.type.startsWith('data-') ? parsed.data : null

      switch (routingEvent) {
        case 'text_delta':
          if (typeof parsed.delta === 'string') {
            result.fullText += parsed.delta
            callbacks.onTextDelta?.(parsed.delta)
          }
          break
        case 'tool_progress': {
          if (this.verbose) process.stderr.write(`[SSE:tool_progress] raw: ${data.slice(0, 1000)}\n`)
          // v1 frames don't carry `status`; derive from the frame type.
          // tool-output-available also omits toolName, so resolve it from the
          // per-stream map populated on the tool-input-start frame.
          const v1Status = v1StatusFromType(v1Type)
          const status = (parsed.status as 'running' | 'done' | undefined) ?? v1Status
          const callId = typeof parsed.toolCallId === 'string' ? parsed.toolCallId : null
          const rawInlineName = parsed.tool ?? parsed.toolName
          const inlineName = typeof rawInlineName === 'string' && rawInlineName.length > 0 ? rawInlineName : undefined
          if (callId && inlineName) {
            toolNameByCallId.set(callId, inlineName)
          }
          const toolName = inlineName ?? (callId ? toolNameByCallId.get(callId) : undefined)
          const label = typeof parsed.label === 'string' ? parsed.label : undefined

          // If this is a client-executed tool on the tool-input-available frame,
          // fire the dedicated callback so the session can dispatch execution.
          // Strict boolean check — missing field or non-true values fall through
          // to display-only progress handling (backward-compatible with older
          // backends that don't emit the flag).
          if (
            v1Type === 'tool-input-available' &&
            parsed.clientExecuted === true &&
            callId &&
            toolName &&
            callbacks.onClientSideToolCall
          ) {
            const rawInput = parsed.input
            const input =
              rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
                ? (rawInput as Record<string, unknown>)
                : {}
            // Fire-and-forget: session.ts handles awaiting / queueing. We
            // still emit onToolProgress so display/verbose logs are
            // consistent with MCP tools.
            void callbacks.onClientSideToolCall(callId, toolName, input)
          }

          if (status && toolName) {
            callbacks.onToolProgress?.(toolName, status, label)
          }
          if (status === 'done' && callId) toolNameByCallId.delete(callId)
          break
        }
        case 'title': {
          const title = v1Data?.title ?? parsed.title
          if (typeof title === 'string') callbacks.onTitle?.(title)
          break
        }
        case 'actions': {
          if (this.verbose) process.stderr.write(`[SSE:actions] raw: ${data.slice(0, 1000)}\n`)
          const actions = v1Data?.actions ?? parsed.actions ?? []
          result.actions.push(...actions)
          callbacks.onActions?.(actions)
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
          const errorText = typeof parsed.errorText === 'string' ? parsed.errorText : parsed.error
          const msg = sseErrorToMessage(errorText)
          const codeFromBackend =
            typeof parsed.code === 'string' && isAgentErrorCode(parsed.code)
              ? parsed.code
              : inferAgentErrorCodeFromMessage(msg)
          callbacks.onError?.(msg, codeFromBackend)
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
      case 'data-actions':
        return 'actions'
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
  // Calldata
  // ============================================================================

  async getCalldata(id: string): Promise<{ data: string; to?: string; chain?: string }> {
    const res = await fetch(`${this.baseUrl}/agent/calldata/${id}`, {
      headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {},
    })
    if (!res.ok) {
      throw new Error(`Failed to resolve calldata_id ${id}: ${res.status} ${res.statusText}`)
    }
    return res.json() as Promise<{ data: string; to?: string; chain?: string }>
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
  actions: Action[]
  suggestions: Suggestion[]
  transactions: TxReadyPayload[]
  message: ConversationMessage | null
}
