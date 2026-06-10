/**
 * Agent Session Orchestrator
 *
 * Coordinates the full agent chat lifecycle:
 * - Authentication with backend
 * - Conversation management
 * - Message sending and SSE streaming
 * - Client-side tool dispatch (`tool-input-available` SSE events) and
 *   tx_ready synthesis (server-built transactions buffered then signed)
 * - RecentAction reporting back to backend via `context.recent_actions`
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { MemoryStorage, PushNotificationService, type VaultBase } from '@vultisig/sdk'

import { AgentErrorCode } from './agentErrors'
import { authenticateVault } from './auth'
import { AgentClient } from './client'
import { buildMessageContext, buildMinimalContext } from './context'
import { AgentExecutor } from './executor'
import type { AgentConfig, ConversationMessage, MessageContext, RecentAction, UICallbacks } from './types'

// Tools that prompt for the vault password before dispatch. `sign_tx` is
// reached via tx_ready synthesis (not a registry tool name) but uses the
// same gate via `runPasswordGatedTool('sign_tx', …)` below.
const PASSWORD_REQUIRED_TOOLS = new Set(['sign_typed_data', 'sign_tx'])

// Client-side tool dispatch table. Each entry maps an inbound
// `tool-input-available` toolName to the matching per-tool executor method.
// The factory is invoked lazily so the executor pointer is captured at
// dispatch time (lets `dispatchClientSideTool` swap mocks for tests).
//
// Must stay aligned with backend's `clientSideToolNames`. `sign_tx` uses
// the tx_ready channel instead; create_vault / plugin_install /
// create_policy / delete_policy are mobile-only. The CRUD trio
// (vault_coin / vault_chain / address_book) carries an `action: 'add'|'remove'`
// discriminator that each wrapper method switches on internally.
export const CLIENT_SIDE_TOOL_DISPATCH: Record<
  string,
  (executor: AgentExecutor, toolCallId: string, input: Record<string, unknown>) => Promise<RecentAction>
> = {
  sign_typed_data: (ex, id, input) => ex.signTypedData(id, input),
  vault_coin: (ex, id, input) => ex.vaultCoin(id, input),
  vault_chain: (ex, id, input) => ex.vaultChain(id, input),
  address_book: (ex, id, input) => ex.addressBook(id, input),
}

// 2x the backend's 8-iteration cap — belt-and-suspenders against runaway loops.
const MAX_MESSAGE_LOOP_DEPTH = 16

export class AgentSession {
  private client: AgentClient
  private vault: VaultBase
  private executor: AgentExecutor
  private config: AgentConfig
  private conversationId: string | null = null
  private publicKey: string
  private cachedContext: MessageContext | null = null
  private abortController: AbortController | null = null
  private historyMessages: ConversationMessage[] = []
  private pushService: PushNotificationService | null = null
  // Flushed into context.recent_actions on the next outbound request.
  private pendingToolResults: RecentAction[] = []

  constructor(vault: VaultBase, config: AgentConfig) {
    this.vault = vault
    this.config = config
    this.client = new AgentClient(config.backendUrl)
    this.client.verbose = !!config.verbose
    if (config.profile) {
      this.client.setProfile(config.profile)
    }
    this.executor = new AgentExecutor(vault, !!config.verbose, vault.publicKeys.ecdsa, config.vultisig)
    this.publicKey = vault.publicKeys.ecdsa

    if (config.password) {
      this.executor.setPassword(config.password)
    }
  }

  /**
   * Initialize the session: health check, authenticate, create conversation.
   */
  async initialize(ui: UICallbacks): Promise<void> {
    // Health check
    const healthy = await this.client.healthCheck()
    if (!healthy) {
      throw new Error(`Agent backend unreachable at ${this.config.backendUrl}`)
    }

    // Authenticate - use cached token if valid, otherwise sign a new one
    try {
      // Unlock vault first if encrypted
      if (this.vault.isEncrypted) {
        const password = this.config.password || (await ui.requestPassword())
        await (this.vault as any).unlock?.(password)
        this.executor.setPassword(password)
      }

      const cached = loadCachedToken(this.publicKey)
      if (cached) {
        this.client.setAuthToken(cached)
      } else {
        const auth = await authenticateVault(this.client, this.vault, this.config.password)
        this.client.setAuthToken(auth.token)
        saveCachedToken(this.publicKey, auth.token, auth.expiresAt)
      }
    } catch (err: any) {
      throw new Error(`Authentication failed: ${err.message}`)
    }

    // Create or resume conversation
    if (this.config.sessionId) {
      this.conversationId = this.config.sessionId
      // Fetch historical messages for resumed sessions
      try {
        const conv = await this.client.getConversation(this.conversationId, this.publicKey)
        this.historyMessages = conv.messages || []
      } catch (err: any) {
        // Re-authenticate on 401/403 and retry once
        if (err.message?.includes('401') || err.message?.includes('403')) {
          clearCachedToken(this.publicKey)
          const auth = await authenticateVault(this.client, this.vault, this.config.password)
          this.client.setAuthToken(auth.token)
          saveCachedToken(this.publicKey, auth.token, auth.expiresAt)
          const conv = await this.client.getConversation(this.conversationId!, this.publicKey)
          this.historyMessages = conv.messages || []
        } else {
          // Session not found or other error — reset to new conversation
          this.conversationId = null
          this.historyMessages = []
          const conv = await this.client.createConversation(this.publicKey)
          this.conversationId = conv.id
        }
      }
    } else {
      const conv = await this.client.createConversation(this.publicKey)
      this.conversationId = conv.id
    }

    // Pre-build context — skip slow balance fetches in agent modes since the
    // backend agent can query balances on demand via MCP tools.
    this.cachedContext =
      this.config.viaAgent || this.config.askMode
        ? await buildMinimalContext(this.vault)
        : await buildMessageContext(this.vault)

    // Connect to notification service for real-time push delivery
    if (this.config.notificationUrl && ui.onNotification) {
      try {
        // Polyfill WebSocket for Node.js (PushNotificationService uses the global)
        if (!globalThis.WebSocket) {
          const { WebSocket } = await import('ws')
          globalThis.WebSocket = WebSocket as any
        }

        const token = crypto.randomUUID()
        this.pushService = new PushNotificationService(new MemoryStorage(), this.config.notificationUrl)

        await this.pushService.registerDevice({
          vaultId: this.publicKey,
          partyName: 'cli-agent',
          token,
          deviceType: 'electron',
        })

        this.pushService.onSigningRequest(notification => {
          // vaultName carries "title\nbody", qrCodeData carries the deeplink
          ui.onNotification?.(notification.vaultName, notification.qrCodeData)
        })

        this.pushService.connect({
          vaultId: this.publicKey,
          partyName: 'cli-agent',
          token,
        })
      } catch (err) {
        if (this.config.verbose) {
          process.stderr.write(`[session] push notification setup failed: ${err}\n`)
        }
      }
    }
  }

  getConversationId(): string | null {
    return this.conversationId
  }

  getHistoryMessages(): ConversationMessage[] {
    return this.historyMessages
  }

  getVaultAddresses(): Record<string, string> {
    return this.cachedContext?.addresses || {}
  }

  /**
   * Send a user message and process the full response cycle.
   *
   * Flow:
   * 1. Send message to backend via SSE stream
   * 2. Collect text deltas and actions
   * 3. Execute auto-execute actions locally
   * 4. Report results back to backend
   * 5. Repeat if backend sends more actions
   */
  async sendMessage(content: string, ui: UICallbacks): Promise<void> {
    if (!this.conversationId) {
      throw new Error('Session not initialized')
    }

    this.abortController = new AbortController()

    // Refresh context before each message — skip balance fetches in agent modes
    try {
      this.cachedContext =
        this.config.viaAgent || this.config.askMode
          ? await buildMinimalContext(this.vault)
          : await buildMessageContext(this.vault)
    } catch {
      // Use stale context
    }

    try {
      await this.processMessageLoop(content, ui)
    } catch (err: any) {
      // SF: any failure that escaped processMessageLoop's internal 401
      // retry — clear the queue so the next user turn doesn't silently
      // inherit stale tool results and trigger phantom auto-submit or
      // hallucinated success messages.
      this.pendingToolResults = []
      throw err
    } finally {
      this.abortController = null
    }
  }

  /**
   * Core message processing loop.
   * Sends content or action results, executes returned actions, repeats.
   */
  private async processMessageLoop(content: string | null, ui: UICallbacks, depth: number = 0): Promise<void> {
    if (!this.conversationId) return

    if (depth > MAX_MESSAGE_LOOP_DEPTH) {
      process.stderr.write(
        `[session] processMessageLoop exceeded MAX_MESSAGE_LOOP_DEPTH (${MAX_MESSAGE_LOOP_DEPTH}); stopping. pendingToolResults=${this.pendingToolResults.length}\n`
      )
      this.pendingToolResults = [] // don't leak into next sendMessage
      ui.onDone()
      return
    }

    // Build request
    const request: any = {
      public_key: this.publicKey,
      context: this.cachedContext ? { ...this.cachedContext } : {},
    }

    // Signal to backend that an AI agent is calling (adjusts prompt for structured output)
    if (this.config.viaAgent || this.config.askMode) {
      request.via_agent = true
    }

    if (content) {
      request.content = content
    }

    // CR2: snapshot the batch BEFORE the splice so an HTTP failure can
    // restore the queue and let the caller retry without re-dispatching
    // tools that already mutated vault state.
    let flushedThisCall: RecentAction[] = []
    if (this.pendingToolResults.length > 0) {
      flushedThisCall = [...this.pendingToolResults]
      request.context.recent_actions = this.pendingToolResults.splice(0)
      if (this.config.verbose) {
        process.stderr.write(`[session] flushed ${request.context.recent_actions.length} recent_actions into request\n`)
      }
    }

    // tx_ready count is NOT streamResult.transactions.length — errors/empty events also push there.
    let serverTxStoredFromStream = 0
    const pendingDispatches: Promise<void>[] = []
    // Serialize client-side tool dispatches in SSE arrival order. Without
    // this, ordering-sensitive flows (vault_chain add → vault_coin add) race
    // and the single-slot password resolver hangs when two dispatches both
    // prompt.
    let dispatchChain: Promise<void> = Promise.resolve()

    // Send via SSE stream. CR2: 401/403 retry happens at the request
    // boundary so the retry replays the EXACT same request body (same
    // content, same recent_actions) — moving it up to sendMessage's catch
    // would re-deliver the original user message and cause the LLM to
    // re-emit tool calls (runaway loop). Non-auth errors restore the
    // spliced batch so callers can retry the queue.
    const callbacks = {
      onTextDelta: (delta: string) => ui.onTextDelta(delta),
      onToolProgress: (tool: string, status: 'running' | 'done', label?: string, ok?: boolean) => {
        if (status === 'running') {
          ui.onToolCall(`mcp-${tool}`, tool)
        } else {
          // `ok ?? true`: only report failure when the stream positively
          // identified an error payload; absent output (older backends)
          // keeps the prior optimistic default so this can't regress
          // legitimate successes (fund-safety bug #B fix).
          const success = ok ?? true
          ui.onToolResult(`mcp-${tool}`, tool, success, { label }, success ? undefined : `${tool} reported an error`)
        }
      },
      onClientSideToolCall: (toolCallId: string, toolName: string, input: Record<string, unknown>) => {
        const dispatch = dispatchChain.then(() => this.dispatchClientSideTool(toolCallId, toolName, input, ui))
        dispatchChain = dispatch.catch(() => {})
        pendingDispatches.push(dispatch)
      },
      onTitle: (_title: string) => {
        // Title updates handled internally
      },
      onSuggestions: (suggestions: any[]) => {
        ui.onSuggestions(suggestions)
      },
      onTxReady: (tx: any) => {
        if (this.executor.storeServerTransaction(tx)) {
          serverTxStoredFromStream++
          if (this.config.password) {
            this.executor.setPassword(this.config.password)
          }
        }
      },
      onMessage: (_msg: any) => {
        // Final message received
      },
      onError: (error: string, code: AgentErrorCode) => {
        ui.onError(error, code)
      },
    }

    // CR2: 401/403 retry at the request boundary so the replay uses the
    // EXACT same request body (same content, same recent_actions). Doing
    // this in sendMessage's catch would re-deliver the original user
    // message and trigger an LLM-loop where it re-emits the same tool
    // calls forever.
    let streamResult
    let authRetried = false
    while (true) {
      try {
        streamResult = await this.client.sendMessageStream(
          this.conversationId,
          request,
          callbacks,
          this.abortController?.signal
        )
        break
      } catch (err: any) {
        const isAuthErr = err.message?.includes('401') || err.message?.includes('403')
        if (isAuthErr && !authRetried) {
          authRetried = true
          clearCachedToken(this.publicKey)
          const auth = await authenticateVault(this.client, this.vault, this.config.password)
          this.client.setAuthToken(auth.token)
          saveCachedToken(this.publicKey, auth.token, auth.expiresAt)
          continue
        }
        // Non-401 or already retried: restore the spliced batch so the
        // caller (or next user turn) can resume from the same queue
        // state. SF in sendMessage's catch will clear if the user
        // doesn't retry.
        if (flushedThisCall.length > 0) {
          this.pendingToolResults = [...flushedThisCall, ...this.pendingToolResults]
        }
        throw err
      }
    }

    // Wait for client-side dispatches (they push onto pendingToolResults).
    if (pendingDispatches.length > 0) {
      await Promise.all(pendingDispatches)
    }

    // Final message event wins over streamed deltas (which may be partial).
    const responseText = streamResult.message?.content || streamResult.fullText || ''

    const displayText = stripLeakedToolCallTags(responseText)
    if (displayText) {
      ui.onAssistantMessage(displayText)
    }

    // tx_ready → synthetic sign_tx → executor.signTxFromBuffer.
    // Routed straight to the executor (no Action wrapper); result is
    // pushed onto pendingToolResults and recursed for the next turn.
    //
    // Backend contract: the agent emits at most one tx_ready per stream
    // turn. storeServerTransaction overwrites a single 'latest' buffer
    // slot — if the backend ever emits two tx_ready events in one turn,
    // only the last would be signed. That is not a currently supported
    // flow; multi-leg sequences use separate turns via recursion.
    if (serverTxStoredFromStream > 0) {
      if (this.config.verbose)
        process.stderr.write(
          `[session] ${serverTxStoredFromStream} stored server tx from tx_ready, signing client-side\n`
        )
      // tx_sign_<ts> is a label only — preserves prior log-grep semantics.
      const signToolCallId = `tx_sign_${Date.now()}`
      const recent = await this.runPasswordGatedTool('sign_tx', signToolCallId, ui, () =>
        this.executor.signTxFromBuffer(signToolCallId)
      )
      this.pendingToolResults.push(recent)
      // Emit tx_status when broadcast succeeded so pipe-mode consumers see it.
      if (recent.success && recent.data) {
        const txHash = recent.data.tx_hash as string | undefined
        const chain = recent.data.chain as string | undefined
        const explorerUrl = recent.data.explorer_url as string | undefined
        if (txHash) ui.onTxStatus(txHash, chain || '', 'pending', explorerUrl)
      }
      await this.processMessageLoop(null, ui, depth + 1)
      return
    }

    // Client-side tool results accumulated — recurse to deliver them.
    if (this.pendingToolResults.length > 0) {
      await this.processMessageLoop(null, ui, depth + 1)
      return
    }

    ui.onDone()
  }

  /**
   * Wrap a per-tool dispatch with the password-prompt gate (for tools in
   * {@link PASSWORD_REQUIRED_TOOLS}) and `ui.onToolCall` /
   * `ui.onToolResult` lifecycle events. Returns the `RecentAction` produced
   * by the executor (or a synthetic failure `RecentAction` if the password
   * prompt was declined).
   */
  private async runPasswordGatedTool(
    toolName: string,
    toolCallId: string,
    ui: UICallbacks,
    body: () => Promise<RecentAction>,
    input?: Record<string, unknown>
  ): Promise<RecentAction> {
    // Confirmation gate: a signable tool (sign_tx / sign_typed_data) must be
    // explicitly approved before it signs + broadcasts. This is the single
    // chokepoint for BOTH the tx_ready path and client-side dispatch, so one
    // gate here covers every signing route (incl. both legs of a multi-leg
    // swap, which sign in one body() call). In ask mode this defaults to DENY
    // unless `--yes` was passed; the TUI prompts y/N and pipe mode defers to
    // the host — see each UICallbacks.requestConfirmation impl.
    if (PASSWORD_REQUIRED_TOOLS.has(toolName)) {
      // getPendingSummary describes the tx_ready buffer, which only sign_tx
      // consumes. A declined sign_tx leaves that buffer populated, so a later
      // sign_typed_data must NOT pick it up — the user would be approving
      // typed-data while reading a stale send/swap summary.
      const summary =
        (toolName === 'sign_tx' ? this.executor.getPendingSummary() : null) ??
        `${toolName}${input ? ` ${JSON.stringify(input)}` : ''}`
      const approved = await ui.requestConfirmation(summary)
      if (!approved) {
        const declined: RecentAction = {
          tool: toolName,
          success: false,
          data: {
            error: 'Transaction not confirmed',
            code: AgentErrorCode.CONFIRMATION_REQUIRED,
            proposed: summary,
          },
        }
        ui.onToolCall(toolCallId, toolName, input)
        ui.onToolResult(
          toolCallId,
          toolName,
          false,
          declined.data,
          'Transaction not confirmed',
          AgentErrorCode.CONFIRMATION_REQUIRED
        )
        return declined
      }
    }

    // Delay caching the prompted password until after body() succeeds so a
    // wrong password triggers a re-prompt on the next call rather than
    // staying silently locked in to a bad value.
    let promptedPassword: string | undefined
    if (PASSWORD_REQUIRED_TOOLS.has(toolName) && !this.config.password) {
      try {
        promptedPassword = await ui.requestPassword()
        this.executor.setPassword(promptedPassword)
      } catch {
        const failure: RecentAction = {
          tool: toolName,
          success: false,
          data: { error: 'Password not provided', code: AgentErrorCode.PASSWORD_REQUIRED },
        }
        ui.onToolCall(toolCallId, toolName, input)
        ui.onToolResult(
          toolCallId,
          toolName,
          false,
          failure.data,
          'Password not provided',
          AgentErrorCode.PASSWORD_REQUIRED
        )
        return failure
      }
    }

    ui.onToolCall(toolCallId, toolName, input)
    let recent: RecentAction
    try {
      recent = await body()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      recent = { tool: toolName, success: false, data: { error: message } }
    }
    const errorMsg = (recent.data?.error as string | undefined) ?? undefined
    const errorCode = (recent.data?.code as AgentErrorCode | undefined) ?? undefined
    ui.onToolResult(toolCallId, toolName, recent.success, recent.data, errorMsg, errorCode)
    // Only persist the prompted password once the tool call proves it's usable.
    if (promptedPassword && recent.success) {
      this.config.password = promptedPassword
    }
    return recent
  }

  // Routes client-side tool calls through the per-tool registry. Missing
  // entries surface as a visible `[cli] unimplemented` warning + failure
  // RecentAction (never silent).
  private async dispatchClientSideTool(
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
    ui: UICallbacks
  ): Promise<void> {
    const handler = CLIENT_SIDE_TOOL_DISPATCH[toolName]
    if (!handler) {
      process.stderr.write(`[cli] unimplemented client-side tool: ${toolName}\n`)
      this.pendingToolResults.push({
        tool: toolName,
        success: false,
        data: { error: `unimplemented in CLI: ${toolName}` },
      })
      return
    }

    let recent: RecentAction
    try {
      recent = await this.runPasswordGatedTool(
        toolName,
        toolCallId,
        ui,
        () => handler(this.executor, toolCallId, input),
        input
      )
    } catch (err) {
      // Handlers wrap their own errors; this catch only fires if the
      // RecentAction adapter (`runTool`) itself blows up unexpectedly.
      const message = err instanceof Error ? err.message : String(err)
      recent = { tool: toolName, success: false, data: { error: message } }
    }

    // Echo protocol markers (__*, pm_order_ref) back so server-side
    // handlers like autoSubmitPolymarketOrder can find them.
    if (recent.data === undefined) recent.data = {}
    for (const key of Object.keys(input)) {
      if (key.startsWith('__') || key === 'pm_order_ref') {
        recent.data[key] = input[key]
      }
    }
    this.pendingToolResults.push(recent)
  }

  /**
   * Cancel the current operation.
   */
  cancel(): void {
    this.abortController?.abort()
  }

  /**
   * Clean up session resources.
   */
  dispose(): void {
    this.cancel()
    this.pushService?.disconnect()
    this.pushService = null
    this.cachedContext = null
    this.conversationId = null
    this.historyMessages = []
  }
}

/**
 * stripLeakedToolCallTags removes model-native tool-call syntax that leaked
 * into assistant text content, returning only the narrative portion for
 * display.
 *
 * Some models (notably MiniMax M2.x) occasionally regress from OpenAI-style
 * structured tool_calls back to their native Harmony-style tags:
 *
 *   <minimax:tool_call>
 *     <invoke name="abi_encode">
 *       <parameter name="signature">transfer(address,uint256)</parameter>
 *     </invoke>
 *   </minimax:tool_call>
 *
 * These tags are the backend's responsibility to detect and rewrite into
 * real tool_calls. If one leaks through anyway the CLI should strip it
 * from the displayed text — showing raw XML to the user is confusing.
 *
 * We deliberately do NOT synthesise client-side actions from these tags.
 * That used to happen (via the old `parseInlineToolCalls` function) and
 * caused a production incident: MCP tool names inside <invoke> blocks
 * were routed into the client action executor which doesn't implement
 * them, failed with "not implemented locally", and eventually led the
 * model to fabricate hallucinated calldata. The CLI only displays.
 *
 * Exported for unit testing.
 */
export function stripLeakedToolCallTags(text: string): string {
  if (!text) return ''
  if (!/<invoke\s+name="[^"]*">/.test(text) && !text.includes('minimax:tool_call')) {
    return text
  }
  return text
    .replace(/<invoke\s+name="[^"]*">[\s\S]*?<\/invoke>/g, '')
    .replace(/<\/?minimax:tool_call>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ============================================================================
// Agent Token Cache
//
// Persists JWT tokens to ~/.vultisig/agent-tokens.json keyed by vault public key.
// Tokens are reused on startup if not expired, avoiding a costly MPC signing round.
// ============================================================================

type TokenEntry = { token: string; expiresAt: number }
type TokenStore = Record<string, TokenEntry>

function getTokenCachePath(): string {
  const dir = process.env.VULTISIG_CONFIG_DIR ?? join(homedir(), '.vultisig')
  return join(dir, 'agent-tokens.json')
}

function readTokenStore(): TokenStore {
  try {
    const path = getTokenCachePath()
    if (!existsSync(path)) return {}
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return {}
  }
}

function writeTokenStore(store: TokenStore): void {
  const path = getTokenCachePath()
  const dir = join(path, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2), { mode: 0o600 })
}

/**
 * Load a cached token for a vault if it exists and hasn't expired.
 * Adds a 60-second buffer to avoid using tokens right at expiry.
 */
function loadCachedToken(publicKey: string): string | null {
  const store = readTokenStore()
  const entry = store[publicKey]
  if (!entry) return null

  const now = Date.now()
  const expiresMs = entry.expiresAt * (entry.expiresAt < 1e12 ? 1000 : 1)
  if (now >= expiresMs - 60_000) {
    // Expired or about to expire - clean it up
    delete store[publicKey]
    try {
      writeTokenStore(store)
    } catch {
      /* ignore */
    }
    return null
  }

  return entry.token
}

function saveCachedToken(publicKey: string, token: string, expiresAt: number): void {
  const store = readTokenStore()
  store[publicKey] = { token, expiresAt }
  try {
    writeTokenStore(store)
  } catch {
    /* ignore */
  }
}

function clearCachedToken(publicKey: string): void {
  const store = readTokenStore()
  delete store[publicKey]
  try {
    writeTokenStore(store)
  } catch {
    /* ignore */
  }
}
