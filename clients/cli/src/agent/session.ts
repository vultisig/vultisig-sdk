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
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { MemoryStorage, PushNotificationService, type VaultBase } from '@vultisig/sdk'

import { AgentErrorCode } from './agentErrors'
import { authenticateVault } from './auth'
import { CLI_SUPPORTED_SURFACES, extractBalanceSummaryFromText, parseBalanceSummaryEnvelope } from './cards'
import { AgentClient, type SSEStreamResult } from './client'
import { buildMessageContext, buildMinimalContext } from './context'
import { AgentExecutor, resolveChain } from './executor'
import type {
  AgentConfig,
  ConversationMessage,
  MessageContext,
  RecentAction,
  TxReadyPayload,
  UICallbacks,
} from './types'

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

// Mid-turn disconnect recovery (matches the app's 2s poller / ~3min ceiling).
// On a dropped SSE stream the session polls /messages/since this many times,
// this far apart, for the assistant message the detached backend persisted.
const RECOVERY_POLL_INTERVAL_MS = 2000
const RECOVERY_MAX_POLLS = 90

// Post-broadcast confirmation polling (audit F1). A bare `pending` status only
// means "broadcast accepted" — the tx can still revert, expire, or be dropped.
// After broadcast the session polls vault.getTxStatus until the tx reaches a
// final state, then emits `confirmed`/`failed` (or `timeout` when the budget is
// exhausted). Ceiling ≈ interval × (maxPolls − 1) ≈ 3s × 39 ≈ 117s.
const TX_CONFIRM_POLL_INTERVAL_MS = 3000
const TX_CONFIRM_MAX_POLLS = 40

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
  // Disconnect-recovery poll cadence — instance fields so tests can drive the
  // poll loop without real 2s waits.
  private recoveryPollIntervalMs = RECOVERY_POLL_INTERVAL_MS
  private recoveryMaxPolls = RECOVERY_MAX_POLLS
  // Post-broadcast confirmation poll cadence — instance fields so tests can
  // drive the loop without real waits.
  private txConfirmPollIntervalMs = TX_CONFIRM_POLL_INTERVAL_MS
  private txConfirmMaxPolls = TX_CONFIRM_MAX_POLLS

  constructor(vault: VaultBase, config: AgentConfig) {
    this.vault = vault
    this.config = config
    this.client = new AgentClient(config.backendUrl)
    this.client.verbose = !!config.verbose
    // Registry-based client-side tool identification: tell the client which
    // tools the CLI executes locally so a `tool-input-available` frame is
    // dispatched on toolName membership (mirroring the app's toolUIRegistry),
    // not on a `clientExecuted` wire flag the backend no longer sends.
    this.client.setClientSideToolNames(new Set(Object.keys(CLIENT_SIDE_TOOL_DISPATCH)))
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
        saveCachedToken(this.publicKey, auth.token, auth.expiresAt, auth.refreshToken)
      }
    } catch (err: any) {
      throw new Error(`Authentication failed: ${err.message}`)
    }

    // Create or resume conversation. Every conversation request routes through
    // withAuthRetry so a revoked-but-unexpired cached token recovers uniformly
    // (clear → re-auth → retry once) on EVERY path — the fresh-convo create
    // used to skip this and hard-throw `Authentication failed` (finding a).
    if (this.config.sessionId) {
      this.conversationId = this.config.sessionId
      // Fetch historical messages for resumed sessions.
      try {
        const conv = await this.withAuthRetry(() => this.client.getConversation(this.conversationId!, this.publicKey))
        this.historyMessages = conv.messages || []
      } catch (err: any) {
        // Resume failed: a stale/typo'd --session-id, a persistent backend
        // error, or an auth failure that survived the single retry. Fall back
        // to a fresh conversation rather than hard-failing (finding b — the old
        // 401 branch retried getConversation once with no fallback and threw
        // uncaught on a second failure), but surface a typed, NON-FATAL signal
        // so a headless caller knows prior context was dropped and can persist
        // the NEW conversation id (finding c — the fallback used to be silent).
        this.conversationId = null
        this.historyMessages = []
        const conv = await this.withAuthRetry(() => this.client.createConversation(this.publicKey))
        this.conversationId = conv.id
        ui.onError(
          `Session ${this.config.sessionId} could not be resumed (${err?.message ?? 'unknown error'}); started a new conversation ${conv.id}`,
          AgentErrorCode.SESSION_NOT_FOUND
        )
      }
    } else {
      const conv = await this.withAuthRetry(() => this.client.createConversation(this.publicKey))
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

  /**
   * Run an authenticated backend request and, on a 401/403, do a single
   * clear → re-auth → retry. This is the ONE chokepoint every conversation
   * request shares (resume fetch, fresh-convo create, error-fallback create,
   * and the send-message stream) so a revoked-but-unexpired cached token
   * recovers identically everywhere instead of throwing on some paths.
   *
   * The retry replays the EXACT same `request` closure, which matters for the
   * send-message path: the replayed body must carry the same content +
   * recent_actions or the LLM re-emits tool calls (runaway loop). Re-auth is a
   * full MPC re-sign via authenticateVault — the backend also exposes
   * POST /auth/refresh, but exchanging the refresh token is a future
   * enhancement (see auth.ts); the re-sign is always available.
   *
   * `onReauth` (optional) fires the instant a re-auth is committed to — BEFORE
   * authenticateVault runs — so a caller in a retry loop (recoverDisconnectedTurn)
   * can record that its single re-auth has been spent even if the MPC re-sign
   * itself then throws. Without this hook a re-auth that fails with a non-auth
   * error would let the caller re-enter and re-sign on every iteration.
   */
  private async withAuthRetry<T>(request: () => Promise<T>, onReauth?: () => void): Promise<T> {
    try {
      return await request()
    } catch (err) {
      if (!isAuthError(err)) throw err
      onReauth?.()
      // authenticateVault (MPC re-sign) may not return a refreshToken; capture
      // the previously cached one before clearing so it survives the re-auth and
      // the later /auth/refresh path stays available.
      const previousRefreshToken = readTokenStore()[this.publicKey]?.refreshToken
      clearCachedToken(this.publicKey)
      const auth = await authenticateVault(this.client, this.vault, this.config.password)
      this.client.setAuthToken(auth.token)
      saveCachedToken(this.publicKey, auth.token, auth.expiresAt, auth.refreshToken ?? previousRefreshToken)
      return await request()
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
      // A depth-capped abort truncates the conversation mid-flight and drops the
      // queued results above — it is NOT a clean finish. Emit a distinct typed
      // error FIRST so headless callers can detect the truncation (ask --json
      // surfaces it in the error envelope and exits non-zero; pipe gets a typed
      // `error` frame) instead of reading a bare `done` as success. onDone()
      // still fires after, purely as the turn terminator (pipe consumers read
      // frames until `done`). This error-then-done shape matches the precedent in
      // pipe.ts handleCommand, whose sendMessage catch emits an `error` frame then
      // `done`. It is deliberately NOT the requestPassword/requestConfirmation
      // shape: those emit NON-terminal `error` frames and keep the turn alive
      // awaiting a reply. Pipe-consumer contract: inspect for an `error` frame
      // before treating `done` as success — the error code, not onDone, is the
      // signal.
      ui.onError(
        `agent message loop exceeded ${MAX_MESSAGE_LOOP_DEPTH} turns; conversation truncated`,
        AgentErrorCode.LOOP_DEPTH_EXCEEDED
      )
      ui.onDone()
      return
    }

    // Build request
    const request: any = {
      public_key: this.publicKey,
      context: this.cachedContext ? { ...this.cachedContext } : {},
      // Advertise the card surfaces the CLI can render. Without this the backend
      // takes the legacy path and instructs the model to echo card_payload JSON
      // verbatim into message content (raw JSON in the terminal). With it, the
      // backend emits a typed data-balance_summary SSE part and the model
      // narrates. See cards.ts / backend types.go SupportedSurfaces.
      supported_surfaces: [...CLI_SUPPORTED_SURFACES],
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
    // Whether a balance_summary card was rendered from the SSE data part this
    // turn. When true, the message-content fallback still runs to STRIP any
    // leftover echoed JSON from the displayed text, but does not render a second
    // card (guards against a misbehaving backend emitting both the typed part
    // and a verbatim echo).
    let balanceCardRendered = false
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
      onBalanceSummary: (raw: unknown) => {
        const card = parseBalanceSummaryEnvelope(raw)
        if (card) {
          balanceCardRendered = true
          ui.onBalanceSummary?.(card)
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
    // calls forever. withAuthRetry replays this exact closure once on auth
    // failure; a non-auth error (or a persistent auth failure) rethrows here.
    let streamResult
    try {
      streamResult = await this.withAuthRetry(() =>
        this.client.sendMessageStream(this.conversationId!, request, callbacks, this.abortController?.signal)
      )
    } catch (err) {
      // Non-401 or already-retried auth failure: restore the spliced batch so
      // the caller (or next user turn) can resume from the same queue state.
      // SF in sendMessage's catch will clear if the user doesn't retry.
      if (flushedThisCall.length > 0) {
        this.pendingToolResults = [...flushedThisCall, ...this.pendingToolResults]
      }
      throw err
    }

    // Wait for client-side dispatches (they push onto pendingToolResults).
    if (pendingDispatches.length > 0) {
      await Promise.all(pendingDispatches)
    }

    // Mid-turn disconnect recovery: the SSE stream dropped before the backend
    // delivered the final assistant message. The backend keeps processing on a
    // detached context and persists the answer (+ any tx_ready card), so poll
    // /messages/since to recover what the dropped stream missed. Bounded so a
    // backend that never persists can't hang the turn. `onTxReady` reuses the
    // same callback the live stream uses, so a recovered tx_ready flows through
    // the identical confirm/sign gate below.
    if (streamResult.disconnected && !streamResult.message) {
      ui.onReconnecting?.()
      await this.recoverDisconnectedTurn(streamResult, callbacks.onTxReady, callbacks.onBalanceSummary)
    }

    // Final message event wins over streamed deltas (which may be partial).
    const responseText = streamResult.message?.content || streamResult.fullText || ''

    let displayText = stripLeakedToolCallTags(responseText)

    if (displayText) {
      displayText = this.renderEchoedBalanceCard(displayText, balanceCardRendered, ui)
    }

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
      // Emit tx_status when broadcast succeeded so pipe-mode consumers see it,
      // then poll for the final on-chain outcome (audit F1) so a headless caller
      // learns confirmed/failed/timeout instead of treating broadcast as success.
      if (recent.success && recent.data) {
        const txHash = recent.data.tx_hash as string | undefined
        const chain = recent.data.chain as string | undefined
        const explorerUrl = recent.data.explorer_url as string | undefined
        if (txHash) {
          await this.emitAndConfirmTx(txHash, chain, explorerUrl, depth, ui)
        }
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
   * Recover a turn whose SSE stream dropped before delivering the final
   * assistant message. Polls /messages/since (server-clock anchored via
   * X-Server-Now) until the persisted assistant message lands or the bounded
   * budget is exhausted. On success it patches `streamResult.message` so the
   * normal downstream flow surfaces the answer, and replays any persisted
   * `data-tx_ready` part through `onTxReady` so a recovered signable card hits
   * the same confirm/sign gate as a live one.
   */
  private async recoverDisconnectedTurn(
    streamResult: SSEStreamResult,
    onTxReady: ((tx: TxReadyPayload) => void) | undefined,
    onBalanceSummary: ((raw: unknown) => void) | undefined
  ): Promise<void> {
    if (!this.conversationId) return

    // Prefer the server clock (X-Server-Now, epoch ms); fall back to a slightly
    // back-dated local clock so a missing header can't skew the anchor past the
    // just-persisted message.
    //
    // Fund-safety: the local-clock fallback is only trustworthy enough to
    // recover the *text* answer. Under clock skew between rapid consecutive
    // turns, a back-dated local anchor can reach back far enough that
    // /messages/since returns a PRIOR turn's assistant row; replaying that
    // row's `data-tx_ready` would route an already-superseded transaction into
    // the sign gate (and auto-broadcast it under --yes). So signable cards are
    // replayed only when the anchor came from the server clock — which reliably
    // excludes earlier turns. A stale recovered *text* answer is at worst a
    // cosmetic glitch; a stale recovered *transaction* is not.
    const serverAnchor = serverNowToIso(streamResult.serverNow)
    const since = serverAnchor ?? new Date(Date.now() - 2000).toISOString()
    const replaySignableCards = serverAnchor !== null
    let cursor: string | undefined

    // A token revoked mid-recovery must self-heal, but re-auth is a full MPC
    // re-sign — so spend AT MOST ONE per recovery window. The first auth-failing
    // poll routes through withAuthRetry (clear→reauth→retry once); its onReauth
    // hook flips authRecovered the instant the re-sign is committed to, so even a
    // re-auth that itself fails (MPC error, auth endpoint down) can't re-arm. Once
    // spent, later polls call messagesSince directly with the (best-effort)
    // refreshed token, so a *persistent* 401 can't trigger an MPC re-sign on every
    // poll (bounded re-sign work, no key-share amplification). Later polls still
    // recover the turn if the refreshed token starts working; otherwise the loop
    // exhausts as before. Without the wrap a revoked token would spin through
    // recoveryMaxPolls and silently lose the assistant reply / tx_ready (M1).
    let authRecovered = false

    for (let attempt = 0; attempt < this.recoveryMaxPolls; attempt++) {
      let resp
      try {
        resp = authRecovered
          ? await this.client.messagesSince(this.conversationId!, cursor ? { cursor } : { since })
          : await this.withAuthRetry(
              () => this.client.messagesSince(this.conversationId!, cursor ? { cursor } : { since }),
              () => {
                authRecovered = true
              }
            )
      } catch (err: any) {
        if (this.config.verbose) {
          process.stderr.write(`[session] recovery poll ${attempt + 1} failed: ${err?.message ?? err}\n`)
        }
        await this.recoverySleep()
        continue
      }

      // Advance the opaque cursor so subsequent polls never re-scan or skip ties.
      if (resp.cursor) cursor = resp.cursor

      // The detached backend writes the assistant message last; take the newest
      // assistant row that actually carries content or a recovered card. Newest
      // (not oldest) is deliberate: a single turn can persist several assistant
      // rows (clarifier / fast-path ack, then the final answer), and we want the
      // final one — oldest-after-anchor would surface an early clarifier instead.
      //
      // Fund-safety cross-repo invariant: this "newest qualifying row" is only
      // safe to route to the sign gate because no concurrent writer persists an
      // *executable* tx_ready (full txArgs/send_tx/swap_tx) into a live
      // conversation during the recovery window. The single concurrent writer
      // today — the scheduler — persists an inert `{ proposal_id }` sidecar that
      // `storeServerTransaction` rejects (no tx envelope → returns false → never
      // signed). If a future background path ever persists an executable
      // tx_ready into a shared conversation, this selection + the server-anchor
      // gate would route it straight to the signer (auto-broadcast under --yes);
      // such a writer must scope its conversation or this must filter by turn.
      const assistant = [...resp.messages]
        .reverse()
        .find(m => m.role === 'assistant' && (!!m.content || hasTxReadyPart(m.parts)))
      if (assistant) {
        if (this.config.verbose) {
          process.stderr.write(`[session] recovered assistant message after ${attempt + 1} poll(s)\n`)
        }
        this.applyRecoveredMessage(assistant, streamResult, onTxReady, replaySignableCards, onBalanceSummary)
        return
      }

      await this.recoverySleep()
    }

    if (this.config.verbose) {
      process.stderr.write(`[session] recovery exhausted after ${this.recoveryMaxPolls} polls; turn answer lost\n`)
    }
  }

  /** Sleep between recovery polls. Separate method so tests can stub it out. */
  private recoverySleep(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, this.recoveryPollIntervalMs))
  }

  /**
   * Post-broadcast confirmation polling (audit F1). A bare `pending` status only
   * means "broadcast accepted"; the tx can still revert, expire, or be dropped,
   * so a headless caller that stops at `pending` may mark a later-reverted
   * operation complete. Poll vault.getTxStatus until the tx reaches a final
   * state and emit the matching lifecycle status (`confirmed`/`failed`), or
   * `timeout` when the bounded poll budget is exhausted (the tx may still
   * confirm later — callers can re-check with `vultisig tx-status`).
   *
   * Transient RPC/network errors are treated as "not final yet" and retried
   * until the budget is spent. Best-effort and non-fatal: if the chain can't be
   * resolved or the vault doesn't expose getTxStatus, the caller's already-
   * emitted `pending` status stands and this returns quietly.
   *
   * Scoped to headless callers (ask/pipe) that need machine-readable finality.
   * The interactive TUI already shows `pending` + an explorer link immediately
   * and has the dedicated `vultisig tx-status` command, so blocking its prompt
   * for the full poll budget would be a UX regression the audit didn't scope.
   * The poll also bails on cancel (Ctrl-C aborts the controller) so a long wait
   * is interruptible.
   *
   * The caller only invokes this at message-loop depth 0 (see the call site):
   * inside a multi-turn tool loop the broadcast result already drives the next
   * turn, so blocking here would stack the poll budget per leg without feeding
   * the server any extra signal. Those deeper legs keep their honest `pending`.
   */
  private async emitAndConfirmTx(
    txHash: string,
    chain: string | undefined,
    explorerUrl: string | undefined,
    depth: number,
    ui: UICallbacks
  ): Promise<void> {
    ui.onTxStatus(txHash, chain || '', 'pending', explorerUrl)
    // Only block on confirmation at the top of the loop (depth 0) — the
    // common headless ask/pipe single-tx case, where the command should
    // wait for finality before returning. Inside a multi-turn tool loop
    // (depth > 0) the broadcast result is already queued on
    // pendingToolResults (pushed above) and is what drives the server's
    // next turn; the confirmation status is never fed back to the server,
    // so blocking the recursion here buys no correctness — it would only
    // stack up to the full poll budget (~117s) per leg, a latency cliff
    // for back-to-back/batched txs. Those legs still emit an honest
    // `pending` (re-checkable later via `vultisig tx-status`).
    if (depth === 0) {
      await this.confirmBroadcastedTx(txHash, chain, explorerUrl, ui)
    }
  }

  private async confirmBroadcastedTx(
    txHash: string,
    chainName: string | undefined,
    explorerUrl: string | undefined,
    ui: UICallbacks
  ): Promise<void> {
    if (!this.config.askMode && !this.config.viaAgent) return

    const chain = resolveChain(chainName ?? '')
    // Call the SDK's typed `VaultBase.getTxStatus` directly (no `as any`) so a
    // rename or signature drift on it fails this build — the cast previously
    // swallowed that. The `typeof` guard stays runtime-meaningful: the unit-test
    // harness passes a minimal `this` whose vault may omit getTxStatus, and we
    // also skip chains the SDK can't resolve. (`?.` is redundant at the type
    // level since `this.vault: VaultBase`, but guards that stub at runtime.)
    if (!chain || typeof this.vault?.getTxStatus !== 'function') return

    for (let attempt = 0; attempt < this.txConfirmMaxPolls; attempt++) {
      if (this.abortController?.signal?.aborted) return
      try {
        // TxStatusResult.status is the SDK's exhaustive union
        // `'pending' | 'success' | 'error'`. Only the two terminal states
        // resolve the poll; `'pending'` (and, by the type, nothing else) keeps
        // polling until the budget is spent and we emit `timeout` below — a safe
        // default since the tx may still confirm later.
        const result = await this.vault.getTxStatus({ chain, txHash })
        if (result.status === 'success') {
          ui.onTxStatus(txHash, chainName ?? '', 'confirmed', explorerUrl)
          return
        }
        if (result.status === 'error') {
          ui.onTxStatus(txHash, chainName ?? '', 'failed', explorerUrl)
          return
        }
      } catch (err: any) {
        // Transient (network/RPC) — keep polling until the budget is spent.
        if (this.config.verbose) {
          process.stderr.write(`[session] tx confirm poll ${attempt + 1} failed: ${err?.message ?? err}\n`)
        }
      }
      // No sleep after the final poll — emit timeout without an extra interval.
      if (attempt < this.txConfirmMaxPolls - 1) await this.txConfirmSleep()
    }

    if (this.abortController?.signal?.aborted) return

    if (this.config.verbose) {
      process.stderr.write(
        `[session] tx ${txHash} not confirmed within ${this.txConfirmMaxPolls} polls; emitting timeout\n`
      )
    }
    ui.onTxStatus(txHash, chainName ?? '', 'timeout', explorerUrl)
  }

  /** Sleep between confirmation polls. Separate method so tests can stub it out. */
  private txConfirmSleep(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, this.txConfirmPollIntervalMs))
  }

  /**
   * Fold a recovered assistant message back into the live stream result: the
   * authoritative message wins over any partial deltas, and any persisted
   * `data-tx_ready` part is replayed through the live tx_ready callback so the
   * card flows through the same confirm/sign gate.
   *
   * `replaySignableCards` gates the tx_ready replay: it is false when the
   * recovery anchor was the local-clock fallback (no X-Server-Now), where a
   * recovered card cannot be proven to belong to the current turn. See
   * recoverDisconnectedTurn — a stale tx_ready must never reach the signer.
   */
  private applyRecoveredMessage(
    msg: ConversationMessage,
    streamResult: SSEStreamResult,
    onTxReady: ((tx: TxReadyPayload) => void) | undefined,
    replaySignableCards: boolean,
    onBalanceSummary: ((raw: unknown) => void) | undefined
  ): void {
    streamResult.message = msg
    for (const part of msg.parts ?? []) {
      // Balance-summary cards are read-only display, so replay them
      // UNCONDITIONALLY — they are never gated by replaySignableCards. A stale
      // recovered balance card is at worst cosmetic (the live path renders the
      // same data); only a stale tx_ready is a fund-safety concern. Without this
      // a balance query whose stream dropped mid-turn recovers the text answer
      // but silently loses the card.
      if (part.type === 'data-balance_summary' && part.data) {
        onBalanceSummary?.(part.data)
        continue
      }
      // Signable cards stay gated: a stale tx_ready must never reach the signer
      // (see recoverDisconnectedTurn's server-anchor rationale).
      if (replaySignableCards && part.type === 'data-tx_ready' && part.data && typeof part.data === 'object') {
        const tx = part.data as TxReadyPayload
        streamResult.transactions.push(tx)
        onTxReady?.(tx)
      }
    }
  }

  /**
   * Legacy-path fallback for echoed balance_summary cards. If the backend
   * ignored supported_surfaces (older build) and the model echoed a
   * card_payload verbatim into the message content, pretty-render it instead
   * of dumping raw JSON. The extractor runs even when the SSE card already
   * fired this turn — a misbehaving backend could emit BOTH the typed part and
   * an echoed blob, so we always STRIP the leftover JSON from the displayed
   * text; we only render the card when one wasn't already rendered (no
   * double-render). Returns the text to display with any JSON blob stripped.
   */
  private renderEchoedBalanceCard(displayText: string, alreadyRendered: boolean, ui: UICallbacks): string {
    const extracted = extractBalanceSummaryFromText(displayText)
    if (!extracted) return displayText
    if (!alreadyRendered) {
      ui.onBalanceSummary?.(extracted.card)
    }
    return extracted.remainingText
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
        // Drop the rejected envelope so it can't linger into later turns
        // (stale legs/summary). sign_typed_data has no buffered tx to drop.
        if (toolName === 'sign_tx') {
          this.executor.clearPendingTransaction()
        }
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
          data: {
            error: 'Password not provided',
            code: AgentErrorCode.PASSWORD_REQUIRED,
          },
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
      // Carry a structured code (not just prose) so the backend/LLM can branch:
      // TOOL_UNSUPPORTED means this client can't run the tool at all, so retry
      // is pointless — pick an alternative. Mirrors the `recent.data?.code`
      // convention runPasswordGatedTool reads.
      this.pendingToolResults.push({
        tool: toolName,
        success: false,
        data: { code: AgentErrorCode.TOOL_UNSUPPORTED, error: `unimplemented in CLI: ${toolName}` },
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

    // Echo protocol markers (__*, pm_order_ref, pm_batch_ref) back so
    // server-side handlers like autoSubmitPolymarketOrder and the batch
    // auto-submit (submit_deposit_wallet_batch) can find them. pm_batch_ref
    // has no __ prefix and isn't the order ref, so it must be named here or
    // it's dropped and BATCH approvals never auto-submit.
    if (recent.data === undefined) recent.data = {}
    for (const key of Object.keys(input)) {
      if (key.startsWith('__') || key === 'pm_order_ref' || key === 'pm_batch_ref') {
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

/**
 * Convert an X-Server-Now header (epoch milliseconds as a string) into an
 * RFC3339 timestamp for the /messages/since bootstrap anchor. Returns null
 * when the header is absent or unparseable so the caller can fall back to a
 * local-clock anchor.
 */
export function serverNowToIso(serverNow: string | null): string | null {
  if (!serverNow) return null
  const ms = Number(serverNow)
  if (!Number.isFinite(ms) || ms <= 0) return null
  return new Date(ms).toISOString()
}

/** True if any message part is a persisted `data-tx_ready` signable card. */
function hasTxReadyPart(parts: ConversationMessage['parts']): boolean {
  return !!parts?.some(p => p.type === 'data-tx_ready' && !!p.data)
}

/**
 * Classify a thrown backend error as an auth failure (401/403). The AgentClient
 * surfaces HTTP status by embedding it in the Error message (e.g.
 * "Request failed (401): ..."). A word-boundary match keeps every real status
 * format (`(401)`, `HTTP 401`, bare `401`) while avoiding false positives on
 * digits embedded in a larger number (a `1401` amount, a `4034` port). We do
 * NOT tighten to a parens-only shape: a false NEGATIVE silently breaks auth
 * recovery (the point of this helper), whereas a false positive only costs one
 * wasted re-auth + an idempotent replay of the exact same request.
 */
export function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /\b(401|403)\b/.test(msg)
}

// ============================================================================
// Agent Token Cache
//
// Persists JWT tokens to ~/.vultisig/agent-tokens.json keyed by vault public key.
// Tokens are reused on startup if not expired, avoiding a costly MPC signing round.
// ============================================================================

type TokenEntry = { token: string; expiresAt: number; refreshToken?: string }
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
  // 0o700 dir / 0o600 file: the store holds bearer access + refresh tokens.
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  // mkdirSync's `mode` is honored only when the dir is CREATED; a pre-existing
  // dir (e.g. ~/.vultisig from an older release) keeps its old perms. chmod
  // every write so it can't retain looser perms now that refresh tokens live here.
  try {
    chmodSync(dir, 0o700)
  } catch {
    /* best-effort: non-POSIX FS (e.g. Windows) ignores perms */
  }
  writeFileSync(path, JSON.stringify(store, null, 2), { mode: 0o600 })
  // writeFileSync's `mode` is honored only when the file is CREATED; an existing
  // file keeps its old perms. chmod every write so a pre-existing (or
  // out-of-band) agent-tokens.json can't retain looser perms now that a
  // longer-lived refresh token lives here.
  try {
    chmodSync(path, 0o600)
  } catch {
    /* best-effort: non-POSIX FS (e.g. Windows) ignores perms */
  }
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

// Persists the access token (and optional refresh token) under 0o600 perms.
// The refresh token is captured for a future POST /auth/refresh exchange. A
// prior entry's refreshToken is preserved when this call doesn't carry one
// (e.g. a backend that stops returning refresh_token shouldn't drop the
// still-valid token we already hold).
function saveCachedToken(publicKey: string, token: string, expiresAt: number, refreshToken?: string): void {
  const store = readTokenStore()
  store[publicKey] = {
    token,
    expiresAt,
    refreshToken: refreshToken ?? store[publicKey]?.refreshToken,
  }
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
