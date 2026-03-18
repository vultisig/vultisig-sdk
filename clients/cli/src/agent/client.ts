/**
 * Agent Backend Client
 *
 * HTTP/SSE client for communicating with the agent-backend server.
 * Supports both JSON and SSE streaming responses.
 */
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
  Transaction,
} from './types'

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
      const body = await res.json().catch(() => ({ error: res.statusText }))
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
    await this.delete(`/agent/conversations/${conversationId}`, { public_key: publicKey })
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
      onTitle?: (title: string) => void
      onActions?: (actions: Action[]) => void
      onSuggestions?: (suggestions: Suggestion[]) => void
      onTxReady?: (tx: Transaction) => void
      onMessage?: (msg: ConversationMessage) => void
      onError?: (error: string) => void
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
      const body = await res.json().catch(() => ({ error: res.statusText }))
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

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE events from buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete last line

        let currentEvent = ''
        let currentData = ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            currentData += (currentData ? '\n' : '') + line.slice(6)
          } else if (line === '') {
            // Empty line = end of event
            if (currentEvent && currentData) {
              this.handleSSEEvent(currentEvent, currentData, result, callbacks)
            }
            currentEvent = ''
            currentData = ''
          } else if (line.startsWith(': ')) {
            // SSE comment (ping), ignore
          }
        }

        // Handle case where event+data were the last lines without trailing newline
        if (currentEvent && currentData) {
          this.handleSSEEvent(currentEvent, currentData, result, callbacks)
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
      onTitle?: (title: string) => void
      onActions?: (actions: Action[]) => void
      onSuggestions?: (suggestions: Suggestion[]) => void
      onTxReady?: (tx: Transaction) => void
      onMessage?: (msg: ConversationMessage) => void
      onError?: (error: string) => void
    }
  ): void {
    try {
      const parsed = JSON.parse(data)

      switch (event) {
        case 'text_delta':
          result.fullText += parsed.delta
          callbacks.onTextDelta?.(parsed.delta)
          break
        case 'tool_progress':
          if (this.verbose) process.stderr.write(`[SSE:tool_progress] raw: ${data.slice(0, 1000)}\n`)
          callbacks.onToolProgress?.(parsed.tool, parsed.status, parsed.label)
          break
        case 'title':
          callbacks.onTitle?.(parsed.title)
          break
        case 'actions':
          if (this.verbose) process.stderr.write(`[SSE:actions] raw: ${data.slice(0, 1000)}\n`)
          result.actions.push(...(parsed.actions || []))
          callbacks.onActions?.(parsed.actions || [])
          break
        case 'suggestions':
          result.suggestions.push(...(parsed.suggestions || []))
          callbacks.onSuggestions?.(parsed.suggestions || [])
          break
        case 'tx_ready':
          if (this.verbose) process.stderr.write(`[SSE:tx_ready] raw: ${data.slice(0, 2000)}\n`)
          result.transactions.push(parsed)
          callbacks.onTxReady?.(parsed)
          break
        case 'message':
          result.message = parsed.message || parsed
          callbacks.onMessage?.(result.message!)
          break
        case 'error':
          callbacks.onError?.(parsed.error)
          break
        case 'done':
          // Stream complete
          break
      }
    } catch {
      // Ignore malformed SSE data
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
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({ error: res.statusText }))
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
      const errorBody = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(`Delete failed (${res.status}): ${errorBody.error || res.statusText}`)
    }
  }
}

export type SSEStreamResult = {
  fullText: string
  actions: Action[]
  suggestions: Suggestion[]
  transactions: Transaction[]
  message: ConversationMessage | null
}
