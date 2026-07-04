/**
 * Ask Interface (agent ask mode)
 *
 * One-shot command mode for AI coding agents (Claude Code, Opencode, Cursor, etc.)
 * Sends a single message, processes all tool calls and actions internally,
 * outputs the final response, and exits cleanly.
 *
 * Multi-turn conversations are supported via --session <id>.
 *
 * Usage:
 *   vultisig agent ask "What is my HYPE balance?" --vault t1 --password 1
 *   vultisig agent ask "Send 0.01567 HYPE to myself" --session <id> --vault t1 --password 1
 */
import type { AgentErrorCode } from './agentErrors'
import { isTerminalAgentErrorCode } from './agentErrors'
import type { BalanceSummaryCard } from './cards'
import type { AgentSession } from './session'
import type { Suggestion, TxLifecycleStatus, UICallbacks } from './types'

export type AskResult = {
  sessionId: string
  response: string
  toolCalls: Array<{
    /** Backend tool-call id — lets a headless caller correlate this entry to a turn. */
    id?: string
    action: string
    success: boolean
    data?: Record<string, unknown>
    error?: string
    code?: AgentErrorCode
  }>
  transactions: Array<{
    hash: string
    chain: string
    explorerUrl?: string
    // Final lifecycle status from post-broadcast confirmation polling so a
    // headless caller learns finality, not just that broadcast was accepted:
    // 'pending' (broadcast) → 'confirmed'/'failed' (resolved) | 'timeout'.
    status?: TxLifecycleStatus
  }>
  /** Server-built balance_summary cards rendered this turn. */
  cards: BalanceSummaryCard[]
  /**
   * Set when a backend/stream `error` frame arrived mid-turn. Unlike an HTTP
   * failure (which rejects sendMessage and surfaces via the catch), an SSE
   * error frame resolves the turn normally — so the caller must inspect this
   * to exit non-zero instead of reporting false success.
   */
  error?: { message: string; code: AgentErrorCode }
}

export class AskInterface {
  private session: AgentSession
  private verbose: boolean
  private autoApprove: boolean
  private responseParts: string[] = []
  private toolCalls: AskResult['toolCalls'] = []
  private transactions: AskResult['transactions'] = []
  private cards: BalanceSummaryCard[] = []
  private error: AskResult['error']
  // Initialize-time error, kept SEPARATE from the turn error so it stays the
  // LOWEST-priority signal. initialize() drives getCallbacks() BEFORE the first
  // ask() — a stale --session fallback fires onError(SESSION_NOT_FOUND) there.
  // A real first-turn error must override it, so we never pre-set `this.error`
  // with the init signal; instead partialResult() falls back to `initError` only
  // when the turn produced no error of its own. Cleared after the first turn so
  // later turns don't carry the init signal.
  private initError: AskResult['error']
  // Tracks whether the currently-latched `error` is a terminal one (e.g. the
  // depth cap). A terminal error may overwrite a prior non-terminal one; once a
  // terminal error is recorded, later frames cannot replace it. See onError.
  private errorIsTerminal = false
  // Whether ask() has run at least once. Distinguishes init-time onError (sets
  // initError) from turn onError (sets error), and gates clearing initError so
  // the init signal only carries into the FIRST turn.
  private hasAsked = false

  constructor(session: AgentSession, verbose = false, autoApprove = false) {
    this.session = session
    this.verbose = verbose
    this.autoApprove = autoApprove
  }

  /**
   * Get UI callbacks that silently collect results.
   * Tool progress is logged to stderr in verbose mode.
   */
  getCallbacks(): UICallbacks {
    return {
      onTextDelta: (_delta: string) => {
        // Accumulated via onAssistantMessage
      },

      onToolCall: (_id: string, action: string, params?: Record<string, unknown>) => {
        if (this.verbose) {
          const paramStr = params ? ` ${JSON.stringify(params)}` : ''
          process.stderr.write(`[tool] ${action}${paramStr} ...\n`)
        }
      },

      onToolResult: (
        id: string,
        action: string,
        success: boolean,
        data?: Record<string, unknown>,
        error?: string,
        code?: AgentErrorCode
      ) => {
        this.toolCalls.push({ id, action, success, data, error, code })
        if (this.verbose) {
          const status = success ? 'ok' : `error: ${error}${code ? ` [${code}]` : ''}`
          process.stderr.write(`[tool] ${action}: ${status}\n`)
        }
      },

      onAssistantMessage: (content: string) => {
        // The session may call this multiple times across action loops.
        // Keep the last non-empty message as the final response.
        if (content) {
          this.responseParts.push(content)
        }
      },

      onBalanceSummary: (card: BalanceSummaryCard) => {
        this.cards.push(card)
      },

      onSuggestions: (_suggestions: Suggestion[]) => {
        // Silently ignored in ask mode
      },

      onTxStatus: (txHash: string, chain: string, status: TxLifecycleStatus, explorerUrl?: string) => {
        // One tx now emits multiple lifecycle events (pending → confirmed/
        // failed/timeout). Dedup by hash and update the status in place so the
        // result carries the latest outcome rather than duplicate rows.
        const existing = this.transactions.find(t => t.hash === txHash)
        if (existing) {
          existing.status = status
          if (explorerUrl) existing.explorerUrl = explorerUrl
        } else {
          this.transactions.push({ hash: txHash, chain, explorerUrl, status })
        }
        if (this.verbose) {
          process.stderr.write(`[tx] ${chain}: ${txHash} (${status})\n`)
        }
      },

      onError: (message: string, code: AgentErrorCode) => {
        // An onError fired BEFORE the first ask() (hasAsked === false) is an
        // initialize-time signal (e.g. SESSION_NOT_FOUND from a stale --session
        // fallback). Keep it in initError as the lowest-priority fallback so a
        // real turn error can still override it. For turn errors: latch the first
        // error, but let a terminal code overwrite a previously-recorded non-terminal
        // one (LOOP_DEPTH_EXCEEDED etc.); once a terminal error is latched, later
        // frames cannot replace it. Keep the stderr breadcrumb either way.
        const isTerminal = isTerminalAgentErrorCode(code)
        if (!this.hasAsked) {
          this.initError = { message, code }
        } else if (!this.error || (isTerminal && !this.errorIsTerminal)) {
          this.error = { message, code }
          this.errorIsTerminal = isTerminal
        }
        process.stderr.write(`[error] ${message} [${code}]\n`)
      },

      onDone: () => {
        // Nothing to do — ask() awaits sendMessage which resolves on done
      },

      requestPassword: async (): Promise<string> => {
        throw new Error('Password required but not provided. Use --password flag.')
      },

      requestConfirmation: async (message: string): Promise<boolean> => {
        // Ask mode is non-interactive, so signing must be explicitly authorized
        // with --yes. Default is DENY so a misrouted read-only prompt (e.g. the
        // backend routing "list swap routes" to execute_swap) can't silently
        // move funds. With --yes, unattended signing is opted into deliberately.
        if (!this.autoApprove) {
          process.stderr.write(`[confirm] signing requires --yes — NOT broadcasting: ${message}\n`)
        } else {
          // Audit trail for unattended runs: log exactly what --yes authorized.
          process.stderr.write(`[confirm] auto-approved (--yes): ${message}\n`)
        }
        return this.autoApprove
      },
    }
  }

  /**
   * Send a message and wait for the complete response.
   * All tool calls and actions are executed automatically.
   */
  async ask(message: string): Promise<AskResult> {
    this.responseParts = []
    this.toolCalls = []
    this.transactions = []
    this.cards = []
    // Each turn's error is turn-local — reset it every turn. The initialize-time
    // signal lives separately in initError (see partialResult's `?? initError`),
    // so clearing error here can't drop it. initError carries ONLY into the first
    // turn, so drop it once a prior turn has run.
    this.error = undefined
    if (this.hasAsked) {
      this.initError = undefined
      this.errorIsTerminal = false
    }
    this.hasAsked = true

    const callbacks = this.getCallbacks()
    await this.session.sendMessage(message, callbacks)

    return this.partialResult()
  }

  /**
   * Snapshot of everything collected so far this turn. Identical to a normal
   * `ask()` return, but callable from a catch block when `ask()` THREW mid-turn
   * — e.g. the follow-up request that reports recent_actions back to the backend
   * fails (timeout/5xx/auth) AFTER a tx has already broadcast and `onTxStatus`
   * fired. Lets the caller still surface the already-broadcast tx hash in the
   * error envelope instead of stranding funds the turn just moved.
   */
  partialResult(): AskResult {
    return {
      sessionId: this.session.getConversationId() || '',
      response: this.responseParts[this.responseParts.length - 1] || '',
      toolCalls: this.toolCalls,
      transactions: this.transactions,
      cards: this.cards,
      // A real turn error wins; fall back to the init-time signal (e.g. stale
      // --session SESSION_NOT_FOUND) only when the turn produced no error.
      error: this.error ?? this.initError,
    }
  }
}
