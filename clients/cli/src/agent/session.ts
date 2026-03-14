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

import type { VaultBase } from '@vultisig/sdk'

import { authenticateVault } from './auth'
import { AgentClient } from './client'
import { buildMessageContext } from './context'
import { AgentExecutor } from './executor'
import type { Action, ActionResult, AgentConfig, MessageContext, UICallbacks } from './types'
import { PASSWORD_REQUIRED_ACTIONS } from './types'

export class AgentSession {
  private client: AgentClient
  private vault: VaultBase
  private executor: AgentExecutor
  private config: AgentConfig
  private conversationId: string | null = null
  private publicKey: string
  private cachedContext: MessageContext | null = null
  private abortController: AbortController | null = null

  constructor(vault: VaultBase, config: AgentConfig) {
    this.vault = vault
    this.config = config
    this.client = new AgentClient(config.backendUrl)
    this.executor = new AgentExecutor(vault)
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
        const password = this.config.password || await ui.requestPassword()
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
    if (this.config.conversationId) {
      this.conversationId = this.config.conversationId
    } else {
      const conv = await this.client.createConversation(this.publicKey)
      this.conversationId = conv.id
    }

    // Pre-build context
    this.cachedContext = await buildMessageContext(this.vault)
  }

  getConversationId(): string | null {
    return this.conversationId
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

    // Refresh context before each message
    try {
      this.cachedContext = await buildMessageContext(this.vault)
    } catch {
      // Use stale context
    }

    try {
      await this.processMessageLoop(content, null, ui)
    } catch (err: any) {
      // Re-authenticate on 401/403 and retry once
      if (err.message?.includes('401') || err.message?.includes('403')) {
        clearCachedToken(this.publicKey)
        const auth = await authenticateVault(this.client, this.vault, this.config.password)
        this.client.setAuthToken(auth.token)
        saveCachedToken(this.publicKey, auth.token, auth.expiresAt)
        await this.processMessageLoop(content, null, ui)
      } else {
        throw err
      }
    } finally {
      this.abortController = null
    }
  }

  /**
   * Core message processing loop.
   * Sends content or action results, executes returned actions, repeats.
   */
  private async processMessageLoop(
    content: string | null,
    actionResults: ActionResult[] | null,
    ui: UICallbacks
  ): Promise<void> {
    if (!this.conversationId) return

    // Build request
    const request: any = {
      public_key: this.publicKey,
      context: this.cachedContext,
    }

    if (content) {
      request.content = content
    }

    if (actionResults && actionResults.length > 0) {
      // Send the first action result (backend expects one at a time)
      const result = actionResults[0]
      request.action_result = {
        action: result.action,
        action_id: result.action_id,
        success: result.success,
        data: result.data || {},
        error: result.error || '',
      }
    }

    // Send via SSE stream
    const streamResult = await this.client.sendMessageStream(
      this.conversationId,
      request,
      {
        onTextDelta: delta => ui.onTextDelta(delta),
        onToolProgress: (tool, status, label) => {
          if (status === 'running') {
            ui.onToolCall(`mcp-${tool}`, tool)
          } else {
            ui.onToolResult(`mcp-${tool}`, tool, true, { label })
          }
        },
        onTitle: _title => {
          // Title updates handled internally
        },
        onActions: _actions => {
          // Collected in streamResult
        },
        onSuggestions: suggestions => {
          ui.onSuggestions(suggestions)
        },
        onTxReady: tx => {
          // Store server-built transaction so sign_tx can find it
          this.executor.storeServerTransaction(tx)
          if (this.config.password) {
            this.executor.setPassword(this.config.password)
          }
        },
        onMessage: _msg => {
          // Final message received
        },
        onError: error => {
          ui.onError(error)
        },
      },
      this.abortController?.signal
    )

    // Emit the full assistant message
    // Backend may send text via text_delta events (fullText) or a single message event
    const responseText = streamResult.fullText
      || (streamResult.message as any)?.content
      || ''

    // Check if the response text contains inline tool calls (XML format from the model)
    const inlineActions = parseInlineToolCalls(responseText)
    if (inlineActions.length > 0) {
      // Strip the XML from the displayed text
      const cleanText = responseText
        .replace(/<invoke\s+name="[^"]*">[\s\S]*?<\/invoke>/g, '')
        .replace(/<\/?minimax:tool_call>/g, '')
        .trim()
      if (cleanText) {
        ui.onAssistantMessage(cleanText)
      }
      // Add inline actions to the stream result
      streamResult.actions.push(...inlineActions)
    } else if (responseText) {
      ui.onAssistantMessage(responseText)
    }

    // Filter out sign_tx actions from backend - we handle signing client-side
    // via tx_ready events to avoid timing/ordering issues
    const nonSignActions = streamResult.actions.filter(a => a.type !== 'sign_tx')
    const backendSignActions = streamResult.actions.filter(a => a.type === 'sign_tx')

    // Execute non-sign actions first (add_chain, add_coin, build_tx, etc.)
    if (nonSignActions.length > 0) {
      const results = await this.executeActions(nonSignActions, ui)
      if (results.length > 0) {
        for (const result of results) {
          await this.processMessageLoop(null, [result], ui)
        }
        return
      }
    }

    // Handle transactions from tx_ready events - always sign client-side
    if (streamResult.transactions.length > 0 && this.executor.hasPendingTransaction()) {
      process.stderr.write(`[session] ${streamResult.transactions.length} tx_ready events, signing client-side\n`)
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
          await this.processMessageLoop(null, [result], ui)
        }
        return
      }
    } else if (backendSignActions.length > 0 && this.executor.hasPendingTransaction()) {
      // Fallback: backend sent sign_tx and we have a pending tx
      process.stderr.write(`[session] Backend sent sign_tx action, using it\n`)
      const results = await this.executeActions(backendSignActions, ui)
      if (results.length > 0) {
        for (const result of results) {
          await this.processMessageLoop(null, [result], ui)
        }
        return
      }
    } else if (backendSignActions.length > 0 && !this.executor.hasPendingTransaction()) {
      // Backend wants signing but we have no tx - report error back
      process.stderr.write(`[session] Backend sent sign_tx but no pending tx, reporting error\n`)
      const errorResult: ActionResult = {
        action: 'sign_tx',
        action_id: backendSignActions[0].id,
        success: false,
        error: 'No pending transaction. The swap transaction data was not received.',
      }
      await this.processMessageLoop(null, [errorResult], ui)
      return
    }

    ui.onDone()
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
      ui.onToolResult(action.id, action.type, result.success, result.data, result.error)

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
    this.cachedContext = null
    this.conversationId = null
  }
}

/**
 * Parse inline tool calls from assistant text.
 * The backend sometimes sends tool calls as raw XML in the text stream:
 *   <invoke name="add_coin"><parameter name="tokens">[...]</parameter></invoke>
 */
function parseInlineToolCalls(text: string): Action[] {
  const actions: Action[] = []
  const invokeRegex = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/g
  let match: RegExpExecArray | null

  while ((match = invokeRegex.exec(text)) !== null) {
    const actionType = match[1]
    const body = match[2]
    const params: Record<string, unknown> = {}

    // Parse <parameter name="key">value</parameter> tags
    const paramRegex = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g
    let paramMatch: RegExpExecArray | null
    while ((paramMatch = paramRegex.exec(body)) !== null) {
      const key = paramMatch[1]
      const value = paramMatch[2]
      try {
        params[key] = JSON.parse(value)
      } catch {
        params[key] = value
      }
    }

    actions.push({
      id: `inline_${actionType}_${Date.now()}`,
      type: actionType,
      title: actionType,
      params,
      auto_execute: true,
    })
  }

  return actions
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
    try { writeTokenStore(store) } catch { /* ignore */ }
    return null
  }

  return entry.token
}

function saveCachedToken(publicKey: string, token: string, expiresAt: number): void {
  const store = readTokenStore()
  store[publicKey] = { token, expiresAt }
  try { writeTokenStore(store) } catch { /* ignore */ }
}

function clearCachedToken(publicKey: string): void {
  const store = readTokenStore()
  delete store[publicKey]
  try { writeTokenStore(store) } catch { /* ignore */ }
}
