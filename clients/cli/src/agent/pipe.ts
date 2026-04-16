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
import type { AgentSession } from './session'
import type { PipeInputCommand, PipeOutputEvent, Suggestion, UICallbacks } from './types'

export class PipeInterface {
  private session: AgentSession
  private rl: readline.Interface | null = null
  private stopped = false
  private pendingPasswordResolve: ((password: string) => void) | null = null
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
          .map(m => ({ role: m.role, content: m.content, created_at: m.created_at })),
      })
    }

    // Collect all lines, then process them
    const lines: string[] = []
    let inputDone = false
    let processing = false

    // Listen for input commands
    this.rl.on('line', async (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return
      lines.push(trimmed)

      // Process lines if not already processing
      if (!processing) {
        processing = true
        while (lines.length > 0) {
          const nextLine = lines.shift()!
          try {
            const cmd = JSON.parse(nextLine) as PipeInputCommand
            await this.handleCommand(cmd)
          } catch (err: unknown) {
            const { message, code } = normalizeAgentError(err)
            this.emit({
              type: 'error',
              message: `Invalid input: ${message}`,
              code: code === AgentErrorCode.UNKNOWN_ERROR ? AgentErrorCode.INVALID_INPUT : code,
            })
          }
        }
        processing = false

        // If input is done and no more lines, stop
        if (inputDone && lines.length === 0) {
          this.stop()
        }
      }
    })

    this.rl.on('close', () => {
      inputDone = true
      // If not currently processing, stop immediately
      if (!processing && lines.length === 0) {
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

      onSuggestions: (suggestions: Suggestion[]) => {
        this.emit({ type: 'suggestions', suggestions })
      },

      onTxStatus: (txHash: string, chain: string, status: string, explorerUrl?: string) => {
        this.emit({
          type: 'tx_status',
          tx_hash: txHash,
          chain,
          status: status as 'pending' | 'confirmed' | 'failed',
          explorer_url: explorerUrl,
        })
      },

      onError: (message: string, code: AgentErrorCode) => {
        this.emit({ type: 'error', message, code })
      },

      onDone: () => {
        this.emit({ type: 'done' })
      },

      requestPassword: async (): Promise<string> => {
        // In via-agent mode, wait for a password command from stdin
        return new Promise(resolve => {
          this.pendingPasswordResolve = resolve
          // Signal that password is needed
          this.emit({ type: 'error', message: 'PASSWORD_REQUIRED', code: AgentErrorCode.PASSWORD_REQUIRED })
        })
      },

      requestConfirmation: async (message: string): Promise<boolean> => {
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
        }
        break
      }

      case 'password': {
        if (this.pendingPasswordResolve) {
          this.pendingPasswordResolve(cmd.password)
          this.pendingPasswordResolve = null
        }
        break
      }

      case 'confirm': {
        if (this.pendingConfirmResolve) {
          this.pendingConfirmResolve(cmd.confirmed)
          this.pendingConfirmResolve = null
        }
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

  private emit(event: PipeOutputEvent): void {
    // Write NDJSON to stdout
    process.stdout.write(JSON.stringify(event) + '\n')
  }
}
