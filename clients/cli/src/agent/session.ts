/**
 * Agent Session Orchestrator
 *
 * Coordinates the full agent chat lifecycle:
 * - Authentication with backend
 * - Conversation management
 * - Message sending and SSE streaming
 * - Action execution loop
 * - Result reporting back to backend
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
import type {
  Action,
  ActionResult,
  AgentConfig,
  ConversationMessage,
  MessageContext,
  RecentAction,
  UICallbacks,
} from './types'
import { PASSWORD_REQUIRED_ACTIONS } from './types'

// Client-side tool name → Action.type routed through executor.executeAction.
// Must stay aligned with the backend's `clientSideToolNames`. Unknown tools
// surface as `[cli] unimplemented client-side tool` (not silent).
// `sign_tx` uses the tx_ready channel instead; create_vault / plugin_install /
// create_policy / delete_policy are mobile-only.
export const CLIENT_SIDE_TOOL_DISPATCH: Record<string, string> = {
  sign_typed_data: 'sign_typed_data',
  add_coin: 'add_coin',
  remove_coin: 'remove_coin',
  add_chain: 'add_chain',
  remove_chain: 'remove_chain',
  address_book_add: 'address_book_add',
  address_book_remove: 'address_book_remove',
}

// 2x the backend's 8-iteration cap — belt-and-suspenders against runaway loops.
const MAX_MESSAGE_LOOP_DEPTH = 16

// Exported for tests. Folds error/code into data so the RecentAction wire
// shape is a single {tool, success, data} tuple.
export function actionResultToRecentAction(r: ActionResult): RecentAction {
  if (r.success) {
    return { tool: r.action, success: true, data: r.data ?? {} }
  }
  const data: Record<string, unknown> = { ...(r.data ?? {}) }
  if (r.error) data.error = r.error
  if (r.code) data.code = r.code
  return { tool: r.action, success: false, data }
}

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

      // Give the executor access to the authenticated client for calldata_id resolution
      this.executor.setBackendClient(this.client)
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
    // this, ordering-sensitive flows (add_chain → add_coin) race and the
    // single-slot password resolver hangs when two dispatches both prompt.
    let dispatchChain: Promise<void> = Promise.resolve()

    // Send via SSE stream. CR2: 401/403 retry happens at the request
    // boundary so the retry replays the EXACT same request body (same
    // content, same recent_actions) — moving it up to sendMessage's catch
    // would re-deliver the original user message and cause the LLM to
    // re-emit tool calls (runaway loop). Non-auth errors restore the
    // spliced batch so callers can retry the queue.
    const callbacks = {
      onTextDelta: (delta: string) => ui.onTextDelta(delta),
      onToolProgress: (tool: string, status: 'running' | 'done', label?: string) => {
        if (status === 'running') {
          ui.onToolCall(`mcp-${tool}`, tool)
        } else {
          ui.onToolResult(`mcp-${tool}`, tool, true, { label })
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
      onActions: (_actions: Action[]) => {
        // Legacy data-actions channel: backend no longer emits for
        // client-side tools post-#119; any late-arriving legacy
        // payloads are collected in streamResult for the fallback
        // below.
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

    // data-actions fallback — still fires for schedule_task preview etc.
    // sign_tx is excluded; it has its own synth path below.
    const legacyActions = streamResult.actions.filter(a => a.type !== 'sign_tx')
    if (legacyActions.length > 0) {
      const results = await this.executeActions(legacyActions, ui)

      // If a build_* action succeeded and produced a pending tx, auto-sign client-side
      const hasBuildSuccess = results.some(r => r.success && r.action.startsWith('build_'))
      if (hasBuildSuccess && this.executor.hasPendingTransaction()) {
        if (this.config.verbose)
          process.stderr.write(`[session] build_* action produced pending tx, auto-signing client-side\n`)
        const signAction: Action = {
          id: `tx_sign_${Date.now()}`,
          type: 'sign_tx',
          title: 'Sign transaction',
          params: {},
          auto_execute: true,
        }
        const signResults = await this.executeActions([signAction], ui)
        const signResult = signResults[0]
        if (signResult) {
          this.pendingToolResults.push(actionResultToRecentAction(signResult))
          await this.processMessageLoop(null, ui, depth + 1)
          return
        }
      }

      if (results.length > 0) {
        for (const result of results) {
          this.pendingToolResults.push(actionResultToRecentAction(result))
        }
        await this.processMessageLoop(null, ui, depth + 1)
        return
      }
    }

    // tx_ready → synth sign_tx → executeActions. Result threaded via recent_actions.
    if (serverTxStoredFromStream > 0) {
      if (this.config.verbose)
        process.stderr.write(
          `[session] ${serverTxStoredFromStream} stored server tx from tx_ready, signing client-side\n`
        )
      const signAction: Action = {
        id: `tx_sign_${Date.now()}`,
        type: 'sign_tx',
        title: 'Sign transaction',
        params: {},
        auto_execute: true,
      }
      const results = await this.executeActions([signAction], ui)
      if (results.length > 0) {
        for (const result of results) {
          this.pendingToolResults.push(actionResultToRecentAction(result))
        }
        await this.processMessageLoop(null, ui, depth + 1)
        return
      }
    }

    // Client-side tool results accumulated — recurse to deliver them.
    if (this.pendingToolResults.length > 0) {
      await this.processMessageLoop(null, ui, depth + 1)
      return
    }

    ui.onDone()
  }

  // Routes client-side tool calls through executeAction. Missing registry
  // entries surface as a visible `[cli] unimplemented` warning + failure
  // RecentAction (never silent).
  private async dispatchClientSideTool(
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
    ui: UICallbacks
  ): Promise<void> {
    const actionType = CLIENT_SIDE_TOOL_DISPATCH[toolName]
    if (!actionType) {
      process.stderr.write(`[cli] unimplemented client-side tool: ${toolName}\n`)
      this.pendingToolResults.push({
        tool: toolName,
        success: false,
        data: { error: `unimplemented in CLI: ${toolName}` },
      })
      return
    }

    const action: Action = {
      id: toolCallId,
      type: actionType,
      title: toolName,
      params: input,
      auto_execute: true,
    }

    try {
      const results = await this.executeActions([action], ui)
      const result = results[0]
      if (result) {
        const recent = actionResultToRecentAction(result)
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.pendingToolResults.push({
        tool: toolName,
        success: false,
        data: { error: message },
      })
    }
  }

  /**
   * Execute a list of actions, handling password requirements.
   */
  private async executeActions(actions: Action[], ui: UICallbacks): Promise<ActionResult[]> {
    const results: ActionResult[] = []

    for (const action of actions) {
      if (!this.executor.shouldAutoExecute(action)) {
        continue
      }

      // Handle password requirement
      if (PASSWORD_REQUIRED_ACTIONS.has(action.type)) {
        if (!this.config.password) {
          try {
            const password = await ui.requestPassword()
            this.executor.setPassword(password)
            this.config.password = password
          } catch {
            results.push({
              action: action.type,
              action_id: action.id,
              success: false,
              error: 'Password not provided',
              code: AgentErrorCode.PASSWORD_REQUIRED,
            })
            continue
          }
        }
      }

      // Notify UI that action is executing
      ui.onToolCall(action.id, action.type, action.params)

      // Execute
      const result = await this.executor.executeAction(action)
      results.push(result)

      // Notify UI of result
      ui.onToolResult(action.id, action.type, result.success, result.data, result.error, result.code)

      // If sign_tx succeeded, emit tx status
      if (action.type === 'sign_tx' && result.success && result.data) {
        const txHash = result.data.tx_hash as string
        const chain = result.data.chain as string
        const explorerUrl = result.data.explorer_url as string
        if (txHash) {
          ui.onTxStatus(txHash, chain, 'pending', explorerUrl)
        }
      }
    }

    return results
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
