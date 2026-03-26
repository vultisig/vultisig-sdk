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
import type { AgentSession } from './session'
import type { Suggestion, UICallbacks } from './types'

export type AskResult = {
  sessionId: string
  response: string
  toolCalls: Array<{
    action: string
    success: boolean
    data?: Record<string, unknown>
    error?: string
  }>
  transactions: Array<{
    hash: string
    chain: string
    explorerUrl?: string
  }>
}

export class AskInterface {
  private session: AgentSession
  private verbose: boolean
  private responseParts: string[] = []
  private toolCalls: AskResult['toolCalls'] = []
  private transactions: AskResult['transactions'] = []

  constructor(session: AgentSession, verbose = false) {
    this.session = session
    this.verbose = verbose
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
        _id: string,
        action: string,
        success: boolean,
        data?: Record<string, unknown>,
        error?: string
      ) => {
        this.toolCalls.push({ action, success, data, error })
        if (this.verbose) {
          const status = success ? 'ok' : `error: ${error}`
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

      onSuggestions: (_suggestions: Suggestion[]) => {
        // Silently ignored in ask mode
      },

      onTxStatus: (
        txHash: string,
        chain: string,
        _status: string,
        explorerUrl?: string
      ) => {
        this.transactions.push({ hash: txHash, chain, explorerUrl })
        if (this.verbose) {
          process.stderr.write(`[tx] ${chain}: ${txHash}\n`)
        }
      },

      onError: (message: string) => {
        process.stderr.write(`[error] ${message}\n`)
      },

      onDone: () => {
        // Nothing to do — ask() awaits sendMessage which resolves on done
      },

      requestPassword: async (): Promise<string> => {
        throw new Error(
          'Password required but not provided. Use --password flag.'
        )
      },

      requestConfirmation: async (_message: string): Promise<boolean> => {
        // Auto-confirm all actions in ask mode
        return true
      },
    }
  }

  /**
   * Send a message and wait for the complete response.
   * All tool calls and actions are executed automatically.
   */
  async ask(message: string): Promise<AskResult> {
    const callbacks = this.getCallbacks()
    await this.session.sendMessage(message, callbacks)

    return {
      sessionId: this.session.getConversationId() || '',
      response: this.responseParts[this.responseParts.length - 1] || '',
      toolCalls: this.toolCalls,
      transactions: this.transactions,
    }
  }
}
