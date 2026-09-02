/**
 * Pipe Interface (--via-agent mode)
 *
 * NDJSON-based interface optimized for consumption by another agent
 * over stdin/stdout. Similar to SSE/MCP protocol.
 *
 * Output (stdout): One JSON object per line
 * Input (stdin): One JSON command per line
 */
import * as readline from 'node:readline'

import { AgentErrorCode, normalizeAgentError } from './agentErrors'
import type { BalanceSummaryCard, PolymarketMarketsCard, YieldOpportunitiesCard } from './cards'
import type { AgentSession } from './session'
import type { PipeInputCommand, PipeOutputEvent, Suggestion, TxLifecycleStatus, UICallbacks } from './types'

export class PipeInterface {
  private session: AgentSession
  private rl: readline.Interface | null = null
  private stopped = false
  private inputClosed = false
  private pendingPasswordResolve: ((password: string) => void) | null = null
  private pendingPasswordReject: ((reason: Error) => void) | null = null
  private pendingConfirmResolve: ((confirmed: boolean) => void) | null = null

  constructor(session: AgentSession) {
    this.session = session
    // Pause stdin immediately to prevent data loss during initialization.
    // readline will be created in start() after auth completes.
    process.stdin.pause()
  }

  /**
   * Start the pipe interface.
   */
  async start(vaultName: string, addresses: Record<string, string>): Promise<void> {
    // Create readline now - after auth is complete and we're ready to process input.
    // stdin was paused in constructor to prevent data loss during initialization.
    this.rl = readline.createInterface({
      input: process.stdin,
      output: undefined, // Don't write prompts to stdout
      terminal: false,
    })

    // Emit ready event
    this.emit({ type: 'ready', vault: vaultName, addresses })

    // Emit session ID
    const sessionId = this.session.getConversationId()
    if (sessionId) {
      this.emit({ type: 'session', id: sessionId })
    }

    // Emit historical messages if resuming a session
    const history = this.session.getHistoryMessages()
    if (history.length > 0) {
      this.emit({
        type: 'history',
        messages: history
          .filter(m => m.content_type !== 'action_result')
          .map(m => ({
            role: m.role,
            content: m.content,
            created_at: m.created_at,
          })),
      })
    }

    // Collect parsed commands, then process them
    const commands: PipeInputCommand[] = []
    let inputDone = false
    let processing = false

    // Listen for input commands
    this.rl.on('line', async (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return

      let cmd: PipeInputCommand
      try {
        cmd = JSON.parse(trimmed) as PipeInputCommand
      } catch {
        // Malformed control replies must not wait behind the message whose
        // prompt they were intended to answer. Keep this error static because
        // JSON parser messages can include fragments of malformed input.
        this.emitInvalidInput('Malformed JSON input')
        return
      }

      // Commands that resolve an in-flight prompt must bypass the serialized
      // message queue. A message can be awaiting one of these responses, so
      // queueing the response behind that message would deadlock the session.
      if (cmd?.type === 'confirm' || cmd?.type === 'password') {
        this.handleControlCommand(cmd)
        return
      }

      commands.push(cmd)

      // Process lines if not already processing
      if (!processing) {
        processing = true
        while (commands.length > 0) {
          const nextCommand = commands.shift()!
          try {
            await this.handleCommand(nextCommand)
          } catch (err: unknown) {
            this.emitInvalidInput(err)
          }
        }
        processing = false

        // If input is done and no more lines, stop
        if (inputDone && commands.length === 0) {
          this.stop()
        }
      }
    })

    this.rl.on('close', () => {
      this.inputClosed = true
      inputDone = true
      this.settlePendingPrompts('Password input closed before a reply was received')
      // If not currently processing, stop immediately
      if (!processing && commands.length === 0) {
        this.stop()
      }
    })

    // Keep alive
    await new Promise<void>(resolve => {
      const check = setInterval(() => {
        if (this.stopped) {
          clearInterval(check)
          resolve()
        }
      }, 100)
    })
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.rl?.close()
    this.session.dispose()
  }

  /**
   * Get UI callbacks for the session.
   */
  getCallbacks(): UICallbacks {
    return {
      onTextDelta: (delta: string) => {
        this.emit({ type: 'text_delta', delta })
      },

      onToolCall: (id: string, action: string, params?: Record<string, unknown>) => {
        this.emit({ type: 'tool_call', id, action, params, status: 'running' })
      },

      onToolResult: (
        id: string,
        action: string,
        success: boolean,
        data?: Record<string, unknown>,
        error?: string,
        code?: AgentErrorCode
      ) => {
        this.emit({
          type: 'tool_result',
          id,
          action,
          success,
          data,
          error,
          ...(!success && code ? { code } : {}),
        })
      },

      onAssistantMessage: (content: string) => {
        this.emit({ type: 'assistant', content })
      },

      onBalanceSummary: (card: BalanceSummaryCard) => {
        this.emit({ type: 'balance_summary', card })
      },

      onYieldOpportunities: (card: YieldOpportunitiesCard) => {
        this.emit({ type: 'yield_opportunities', card })
      },

      onPolymarketMarkets: (card: PolymarketMarketsCard) => {
        this.emit({ type: 'polymarket_markets', card })
      },

      onSuggestions: (suggestions: Suggestion[]) => {
        this.emit({ type: 'suggestions', suggestions })
      },

      onTxStatus: (txHash: string, chain: string, status: TxLifecycleStatus, explorerUrl?: string) => {
        this.emit({
          type: 'tx_status',
          tx_hash: txHash,
          chain,
          status,
          explorer_url: explorerUrl,
        })
      },

      onSigningRecord: record => {
        this.emit({ type: 'signing_record', record })
      },

      onError: (message: string, code: AgentErrorCode) => {
        this.emit({ type: 'error', message, code })
      },

      onProtocolWarning: warning => {
        this.emit({ type: 'warning', warning })
      },

      onReconnecting: () => {
        this.emit({ type: 'reconnecting' })
      },

      onDone: () => {
        this.emit({ type: 'done' })
      },

      requestPassword: (): Promise<string> => {
        // A prompt registered after stdin closed can never be answered, and no
        // further close event will settle it — fail it immediately instead.
        if (this.inputClosed) {
          const password = Promise.reject<string>(
            Object.assign(new Error('Password input closed before a reply was received'), {
              code: AgentErrorCode.PASSWORD_REQUIRED,
            })
          )
          void password.catch(() => undefined)
          return password
        }
        // In via-agent mode, wait for a password command from stdin
        const password = new Promise<string>((resolve, reject) => {
          this.pendingPasswordResolve = resolve
          this.pendingPasswordReject = reject
          // Signal that password is needed
          this.emit({
            type: 'error',
            message: 'PASSWORD_REQUIRED',
            code: AgentErrorCode.PASSWORD_REQUIRED,
          })
        })
        // Keep an ignored prompt promise from becoming an unhandled rejection
        // when EOF or turn cleanup rejects it. Awaiting callers still receive
        // the rejection from the original promise.
        void password.catch(() => undefined)
        return password
      },

      requestConfirmation: async (message: string): Promise<boolean> => {
        if (this.inputClosed) return false
        return new Promise(resolve => {
          this.pendingConfirmResolve = resolve
          this.emit({
            type: 'error',
            message: `CONFIRMATION_REQUIRED: ${message}`,
            code: AgentErrorCode.CONFIRMATION_REQUIRED,
          })
        })
      },
    }
  }

  private async handleCommand(cmd: PipeInputCommand): Promise<void> {
    switch (cmd.type) {
      case 'message': {
        const callbacks = this.getCallbacks()
        try {
          await this.session.sendMessage(cmd.content, callbacks)
        } catch (err: unknown) {
          const { message, code } = normalizeAgentError(err)
          this.emit({ type: 'error', message, code })
          this.emit({ type: 'done' })
        } finally {
          this.settlePendingPrompts('Password request cancelled because the turn ended')
        }
        break
      }

      case 'password':
      case 'confirm': {
        this.handleControlCommand(cmd)
        break
      }

      default:
        this.emit({
          type: 'error',
          message: `Unknown command type: ${(cmd as { type?: string }).type}`,
          code: AgentErrorCode.INVALID_INPUT,
        })
    }
  }

  private handleControlCommand(cmd: Extract<PipeInputCommand, { type: 'confirm' | 'password' }>): void {
    if (cmd.type === 'password') {
      if (!this.pendingPasswordResolve) {
        this.emitInvalidInput('No pending password request for this reply')
        return
      }

      if (typeof cmd.password !== 'string') {
        this.emitInvalidInput('Password reply must contain a string password')
        return
      }

      const resolve = this.pendingPasswordResolve
      this.pendingPasswordResolve = null
      this.pendingPasswordReject = null
      resolve(cmd.password)
      return
    }

    if (!this.pendingConfirmResolve) {
      this.emitInvalidInput('No pending confirmation for this reply')
      return
    }

    if (cmd.confirmed !== true && cmd.confirmed !== false) {
      this.emitInvalidInput('Confirmation reply must contain a boolean confirmed value')
      return
    }

    const resolve = this.pendingConfirmResolve
    this.pendingConfirmResolve = null
    resolve(cmd.confirmed === true)
  }

  private settlePendingPrompts(passwordMessage: string): void {
    const confirmResolve = this.pendingConfirmResolve
    this.pendingConfirmResolve = null
    confirmResolve?.(false)

    const passwordReject = this.pendingPasswordReject
    this.pendingPasswordResolve = null
    this.pendingPasswordReject = null
    if (passwordReject) {
      const error = Object.assign(new Error(passwordMessage), { code: AgentErrorCode.PASSWORD_REQUIRED })
      passwordReject(error)
    }
  }

  private emitInvalidInput(err: unknown): void {
    const { message, code } = normalizeAgentError(err)
    this.emit({
      type: 'error',
      message: `Invalid input: ${message}`,
      code: code === AgentErrorCode.UNKNOWN_ERROR ? AgentErrorCode.INVALID_INPUT : code,
    })
  }

  private emit(event: PipeOutputEvent): void {
    // Write NDJSON to stdout
    process.stdout.write(JSON.stringify(event) + '\n')
  }
}
