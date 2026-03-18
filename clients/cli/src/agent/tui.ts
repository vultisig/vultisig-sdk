/**
 * Chat TUI - IRC-style Terminal User Interface
 *
 * Provides an interactive chat interface with:
 * - Message display with timestamps and role labels
 * - Streaming text display for AI responses
 * - Tool execution status indicators
 * - Transaction status display
 * - Password prompts
 * - Suggestion display
 */
import * as readline from 'node:readline'

import chalk from 'chalk'

import type { AgentSession } from './session'
import type { Suggestion, UICallbacks } from './types'

export class ChatTUI {
  private rl: readline.Interface
  private session: AgentSession
  private isStreaming = false
  private currentStreamText = ''
  private vaultName: string
  private stopped = false
  private verbose: boolean

  constructor(session: AgentSession, vaultName: string, verbose = false) {
    this.session = session
    this.vaultName = vaultName
    this.verbose = verbose

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '',
      terminal: true,
    })
  }

  /**
   * Start the interactive chat loop.
   */
  async start(): Promise<void> {
    this.printHeader()
    this.printHelp()
    this.showPrompt()

    // Handle line input
    this.rl.on('line', async (line: string) => {
      const input = line.trim()

      // Clear the echoed line (readline already printed it) and reprint with formatting
      readline.moveCursor(process.stdout, 0, -1)
      readline.clearLine(process.stdout, 0)

      if (!input) {
        this.showPrompt()
        return
      }

      if (input === '/quit' || input === '/exit' || input === '/q') {
        this.stop()
        return
      }

      if (input === '/help' || input === '/h') {
        this.printHelp()
        this.showPrompt()
        return
      }

      if (input === '/clear') {
        console.clear()
        this.printHeader()
        this.showPrompt()
        return
      }

      // Send message
      this.printUserMessage(input)
      await this.handleMessage(input)
      this.showPrompt()
    })

    this.rl.on('close', () => {
      this.stop()
    })

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      if (this.isStreaming) {
        this.session.cancel()
        this.isStreaming = false
        console.log(chalk.yellow('\n  [cancelled]'))
        this.showPrompt()
      } else {
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
    console.log(chalk.gray('\n  Goodbye!\n'))
    this.rl.close()
    this.session.dispose()
  }

  /**
   * Get UI callbacks for the session.
   */
  getCallbacks(): UICallbacks {
    return {
      onTextDelta: (delta: string) => {
        if (!this.isStreaming) {
          this.isStreaming = true
          this.currentStreamText = ''
          // Print agent label
          const ts = this.timestamp()
          process.stdout.write(`${chalk.gray(ts)} ${chalk.cyan.bold('Agent')}: `)
        }
        this.currentStreamText += delta
      },

      onToolCall: (_id: string, action: string, params?: Record<string, unknown>) => {
        if (this.isStreaming) {
          process.stdout.write('\n')
          this.isStreaming = false
        }
        if (this.verbose) {
          const paramStr = params ? chalk.gray(` ${JSON.stringify(params).slice(0, 80)}`) : ''
          console.log(`  ${chalk.yellow('⚡')} ${chalk.yellow(action)}${paramStr} ${chalk.gray('...')}`)
        } else {
          console.log(`  ${chalk.yellow('⚡')} ${chalk.yellow(action)} ${chalk.gray('...')}`)
        }
      },

      onToolResult: (_id: string, action: string, success: boolean, data?: Record<string, unknown>, error?: string) => {
        if (success) {
          if (this.verbose) {
            const summary = data ? summarizeData(data) : ''
            console.log(`  ${chalk.green('✓')} ${chalk.green(action)}${summary ? chalk.gray(` → ${summary}`) : ''}`)
          } else {
            console.log(`  ${chalk.green('✓')} ${chalk.green(action)}`)
          }
        } else {
          console.log(`  ${chalk.red('✗')} ${chalk.red(action)}: ${chalk.red(error || 'failed')}`)
        }
      },

      onAssistantMessage: (content: string) => {
        if (this.isStreaming) {
          // Deltas were collected; render the full text with markdown
          process.stdout.write(renderMarkdown(this.currentStreamText) + '\n')
          this.isStreaming = false
        } else if (content && content !== this.currentStreamText) {
          // Print full message with markdown rendering
          const ts = this.timestamp()
          console.log(`${chalk.gray(ts)} ${chalk.cyan.bold('Agent')}: ${renderMarkdown(content)}`)
        }
        this.currentStreamText = ''
      },

      onSuggestions: (suggestions: Suggestion[]) => {
        if (suggestions.length > 0) {
          console.log(chalk.gray('  Suggestions:'))
          for (const s of suggestions) {
            console.log(chalk.gray(`    • ${s.title}`))
          }
        }
      },

      onTxStatus: (txHash: string, chain: string, status: string, explorerUrl?: string) => {
        const statusIcon = status === 'confirmed' ? chalk.green('✓') : status === 'failed' ? chalk.red('✗') : chalk.yellow('⏳')
        console.log(`  ${statusIcon} ${chalk.bold('TX')} [${chain}]: ${txHash.slice(0, 12)}...${txHash.slice(-8)}`)
        if (explorerUrl) {
          console.log(`     ${chalk.blue.underline(explorerUrl)}`)
        }
      },

      onError: (message: string) => {
        if (this.isStreaming) {
          process.stdout.write('\n')
          this.isStreaming = false
        }
        console.log(`  ${chalk.red('Error')}: ${message}`)
      },

      onDone: () => {
        if (this.isStreaming) {
          // Flush any remaining streamed text
          process.stdout.write(renderMarkdown(this.currentStreamText) + '\n')
          this.isStreaming = false
          this.currentStreamText = ''
        }
      },

      requestPassword: async (): Promise<string> => {
        return new Promise((resolve, reject) => {
          // Use a separate readline for password input
          const rl2 = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
          })

          // Disable echoing for password
          if (process.stdin.isTTY) {
            process.stdout.write(chalk.yellow('  🔐 Enter vault password: '))
            const wasRaw = process.stdin.isRaw
            process.stdin.setRawMode(true)
            let password = ''

            const onData = (key: Buffer) => {
              const ch = key.toString()
              if (ch === '\r' || ch === '\n') {
                process.stdin.setRawMode(wasRaw || false)
                process.stdin.removeListener('data', onData)
                process.stdout.write('\n')
                rl2.close()
                resolve(password)
              } else if (ch === '\x03') {
                // Ctrl+C
                process.stdin.setRawMode(wasRaw || false)
                process.stdin.removeListener('data', onData)
                rl2.close()
                reject(new Error('Password input cancelled'))
              } else if (ch === '\x7f' || ch === '\b') {
                // Backspace
                if (password.length > 0) {
                  password = password.slice(0, -1)
                  process.stdout.write('\b \b')
                }
              } else if (ch.charCodeAt(0) >= 32) {
                password += ch
                process.stdout.write('*')
              }
            }

            process.stdin.on('data', onData)
          } else {
            // Non-TTY: read password from line
            rl2.question('Password: ', answer => {
              rl2.close()
              resolve(answer.trim())
            })
          }
        })
      },

      requestConfirmation: async (message: string): Promise<boolean> => {
        return new Promise(resolve => {
          this.rl.question(chalk.yellow(`  ${message} (y/N): `), answer => {
            resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes')
          })
        })
      },
    }
  }

  private async handleMessage(content: string): Promise<void> {
    const callbacks = this.getCallbacks()
    this.isStreaming = false

    try {
      await this.session.sendMessage(content, callbacks)
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log(chalk.yellow('  [cancelled]'))
      } else {
        console.log(chalk.red(`  Error: ${err.message}`))
      }
    }
  }

  private printHeader(): void {
    console.log('')
    console.log(chalk.bold.cyan(`  ╔═══════════════════════════════════════╗`))
    console.log(chalk.bold.cyan(`  ║`) + chalk.bold(`     Vultisig Agent - ${this.vaultName}`.padEnd(38).slice(0, 38)) + chalk.bold.cyan(`║`))
    console.log(chalk.bold.cyan(`  ╚═══════════════════════════════════════╝`))
    console.log('')
  }

  private printHelp(): void {
    console.log(chalk.gray('  Commands: /help, /clear, /quit'))
    console.log(chalk.gray('  Press Ctrl+C to cancel a response, or to exit'))
    console.log('')
  }

  private printUserMessage(content: string): void {
    const ts = this.timestamp()
    console.log(`${chalk.gray(ts)} ${chalk.green.bold('You')}: ${content}`)
  }

  private showPrompt(): void {
    if (this.stopped) return
    const prompt = chalk.gray(`${this.timestamp()} `) + chalk.green.bold('You') + ': '
    this.rl.setPrompt(prompt)
    this.rl.prompt()
  }

  private timestamp(): string {
    const now = new Date()
    return `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`
  }
}

/**
 * Convert basic markdown to terminal-styled text using chalk.
 */
function renderMarkdown(text: string): string {
  return text
    // Bold: **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, (_m, p1) => chalk.bold(p1))
    .replace(/__(.+?)__/g, (_m, p1) => chalk.bold(p1))
    // Italic: *text* or _text_ (but not inside words like contract_address)
    .replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, (_m, p1) => chalk.italic(p1))
    .replace(/(?<!\w)_([^_]+?)_(?!\w)/g, (_m, p1) => chalk.italic(p1))
    // Inline code: `text`
    .replace(/`([^`]+?)`/g, (_m, p1) => chalk.cyan(p1))
    // Links: [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, p1, p2) => `${p1} ${chalk.blue.underline(`(${p2})`)}`)
}

function summarizeData(data: Record<string, unknown>): string {
  if (data.balances && Array.isArray(data.balances)) {
    const balances = data.balances as any[]
    if (balances.length === 1) {
      return `${balances[0].amount} ${balances[0].symbol}`
    }
    return `${balances.length} balances`
  }
  if (data.tx_hash) {
    return `tx: ${(data.tx_hash as string).slice(0, 12)}...`
  }
  if (data.added) return 'added'
  if (data.removed) return 'removed'
  if (data.message) return data.message as string
  return ''
}
