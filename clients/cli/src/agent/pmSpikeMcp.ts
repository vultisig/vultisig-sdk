/**
 * ⚠️ SPIKE / THROWAWAY — NOT FOR MERGE ⚠️
 *
 * Minimal MCP-over-HTTP (streamable JSON-RPC) client, just enough to drive the
 * mcp-ts Polymarket build→submit primitives DIRECTLY from the CLI, with the LLM
 * removed from the loop. This is the deterministic Path-B wiring proof for the
 * spike documented in
 *   .claude/knowledge/tasks/010726-spike-protocol-commands-report.md
 *
 * We hand-roll the JSON-RPC handshake (initialize → notifications/initialized →
 * tools/call) over `fetch` rather than pull in `@modelcontextprotocol/sdk` as a
 * new CLI dependency — a spike shouldn't touch the dependency graph. mcp-ts runs
 * its `/mcp` transport with `enableJsonResponse: true`, so `tools/call` returns
 * plain JSON-RPC (not SSE); we still tolerate an SSE-framed body defensively.
 *
 * A real implementation would use the official MCP client (session management,
 * reconnect, cancellation) — see the report's "recommended shape".
 */

type JsonRpcResult = {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** A parsed mcp-ts tool result (the `content[0].text` JSON, already decoded). */
export type McpToolResult = Record<string, unknown>

export class PmSpikeMcpClient {
  private readonly baseUrl: string
  private readonly authToken?: string
  private sessionId: string | null = null
  private nextId = 1
  readonly verbose: boolean

  constructor(baseUrl: string, opts?: { authToken?: string; verbose?: boolean }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.authToken = opts?.authToken
    this.verbose = !!opts?.verbose
  }

  private log(msg: string): void {
    if (this.verbose) process.stderr.write(`[pm-spike-mcp] ${msg}\n`)
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      // mcp-ts's WebStandardStreamableHTTP transport requires BOTH be accepted.
      Accept: 'application/json, text/event-stream',
    }
    if (this.authToken) h.Authorization = `Bearer ${this.authToken}`
    if (this.sessionId) h['mcp-session-id'] = this.sessionId
    return h
  }

  /** Decode a `/mcp` response body, tolerating either raw JSON (enableJsonResponse)
   *  or an SSE-framed `data:` line carrying the JSON-RPC envelope. */
  private static decodeBody(raw: string): JsonRpcResult | null {
    const trimmed = raw.trim()
    if (!trimmed) return null
    if (trimmed.startsWith('{')) return JSON.parse(trimmed) as JsonRpcResult
    // SSE frame: pull the last `data:` line and parse it.
    const dataLine = trimmed
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice(5).trim())
      .pop()
    return dataLine ? (JSON.parse(dataLine) as JsonRpcResult) : null
  }

  /** Run the initialize handshake and capture the server-assigned session id. */
  async connect(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'vsig-pm-spike', version: '0.0.0' },
        },
      }),
    })
    if (!res.ok) throw new Error(`MCP initialize failed (${res.status}): ${await res.text()}`)
    this.sessionId = res.headers.get('mcp-session-id')
    this.log(`initialized, session=${this.sessionId ?? '(none)'}`)

    // Fire the initialized notification (no id, no response body expected).
    await fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
    }).catch(() => undefined)
  }

  /** Call a tool and return its decoded JSON payload (the `content[0].text` JSON,
   *  or the structured content). Throws on a JSON-RPC / transport error. */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (!this.sessionId) await this.connect()
    this.log(`tools/call ${name} ${JSON.stringify(args)}`)
    const res = await fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    })
    const raw = await res.text()
    if (!res.ok) throw new Error(`MCP tools/call ${name} failed (${res.status}): ${raw}`)
    const decoded = PmSpikeMcpClient.decodeBody(raw)
    if (!decoded) throw new Error(`MCP tools/call ${name}: empty/unparseable response: ${raw.slice(0, 400)}`)
    if (decoded.error) throw new Error(`MCP tools/call ${name} error ${decoded.error.code}: ${decoded.error.message}`)

    const result = decoded.result as { content?: Array<{ type: string; text?: string }>; isError?: boolean } | undefined
    const textPart = result?.content?.find(c => c.type === 'text')?.text
    if (textPart) {
      try {
        return JSON.parse(textPart) as McpToolResult
      } catch {
        // A textError() result is plain prose, not JSON — surface it as an error.
        throw new Error(`MCP tool ${name} returned a text error: ${textPart}`)
      }
    }
    // No text content — return the raw result envelope for the caller to inspect.
    return (result ?? {}) as McpToolResult
  }
}
