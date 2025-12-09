/**
 * REPL-Safe Prompt Utility
 *
 * Handles stdin conflicts between Node.js REPL and inquirer.
 * When running in interactive mode, the REPL and inquirer both read from stdin.
 * This utility completely disconnects the REPL from stdin during prompts,
 * preventing "Unknown command" errors from stdin competition.
 */
import inquirer, { type Answers, type QuestionCollection } from 'inquirer'
import * as readline from 'readline'
import type * as repl from 'repl'

// Singleton reference to the active REPL server
let activeReplServer: repl.REPLServer | null = null

// Store removed listeners to restore them later
let storedLineListeners: ((...args: any[]) => void)[] = []
let storedCloseListeners: ((...args: any[]) => void)[] = []

/**
 * Register the active REPL server for prompt coordination
 */
export function registerReplServer(server: repl.REPLServer): void {
  activeReplServer = server
}

/**
 * Unregister the REPL server (on shutdown)
 */
export function unregisterReplServer(): void {
  activeReplServer = null
}

/**
 * Check if we're in interactive REPL mode
 */
export function isReplActive(): boolean {
  return activeReplServer !== null
}

/**
 * Completely disconnect REPL from stdin before running a prompt
 */
function disconnectRepl(): void {
  if (!activeReplServer) return

  // Store and remove 'line' listeners (these process user input)
  storedLineListeners = activeReplServer.listeners('line') as ((...args: any[]) => void)[]
  activeReplServer.removeAllListeners('line')

  // Store and remove 'close' listeners
  storedCloseListeners = activeReplServer.listeners('close') as ((...args: any[]) => void)[]
  activeReplServer.removeAllListeners('close')

  // Pause the REPL
  activeReplServer.pause()

  // Disable raw mode so inquirer can control stdin
  if (process.stdin.isTTY && (process.stdin as any).isRaw) {
    process.stdin.setRawMode(false)
  }
}

/**
 * Reconnect REPL to stdin after a prompt completes
 */
function reconnectRepl(): void {
  if (!activeReplServer) return

  // Clear any leftover line from inquirer to prevent duplicate display
  readline.clearLine(process.stdout, 0)
  readline.cursorTo(process.stdout, 0)

  // Restore raw mode for REPL
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
  }

  // Restore 'line' listeners
  for (const listener of storedLineListeners) {
    activeReplServer.on('line', listener)
  }
  storedLineListeners = []

  // Restore 'close' listeners
  for (const listener of storedCloseListeners) {
    activeReplServer.on('close', listener)
  }
  storedCloseListeners = []

  // Resume the REPL - don't call displayPrompt() here
  // The command execution flow will handle showing the next prompt
  activeReplServer.resume()
}

/**
 * REPL-safe wrapper for inquirer.prompt
 *
 * Completely disconnects the REPL from stdin during prompts,
 * preventing stdin conflicts that cause "Unknown command" errors.
 *
 * @param questions - Inquirer question configuration
 * @returns Promise resolving to the answers
 */
export async function replPrompt<T extends Answers = Answers>(
  questions: QuestionCollection<T>
): Promise<T> {
  const wasReplActive = isReplActive()

  if (wasReplActive) {
    disconnectRepl()
  }

  try {
    const answers = await inquirer.prompt<T>(questions)
    return answers
  } finally {
    if (wasReplActive) {
      // Small delay to ensure inquirer has fully released stdin
      await new Promise(resolve => setTimeout(resolve, 50))
      reconnectRepl()
    }
  }
}

