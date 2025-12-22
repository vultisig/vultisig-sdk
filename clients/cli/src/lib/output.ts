/**
 * Output Service - Centralized console output with silent mode support
 *
 * In silent mode, only results and errors are shown.
 * Informational messages, spinners, and success/warn messages are suppressed.
 */
import chalk from 'chalk'
import ora, { type Ora } from 'ora'

// ============================================================================
// Types
// ============================================================================

export type OutputFormat = 'table' | 'json'

// ============================================================================
// State
// ============================================================================

let silentMode = false
let outputFormat: OutputFormat = 'table'

// ============================================================================
// Configuration
// ============================================================================

export function setSilentMode(silent: boolean): void {
  silentMode = silent
}

export function isSilent(): boolean {
  return silentMode
}

/**
 * Initialize output mode from CLI flags and environment variables
 */
export function initOutputMode(options: { silent?: boolean; output?: string }): void {
  outputFormat = (options.output as OutputFormat) ?? 'table'
  silentMode = options.silent ?? process.env.VULTISIG_SILENT === '1'

  // JSON mode implies silent (no spinners, colors)
  if (outputFormat === 'json') {
    silentMode = true
  }
}

/**
 * Check if output format is JSON
 */
export function isJsonOutput(): boolean {
  return outputFormat === 'json'
}

/**
 * Get current output format
 */
export function getOutputFormat(): OutputFormat {
  return outputFormat
}

/**
 * JSON replacer that converts BigInt to string
 */
function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

/**
 * Output structured data as JSON (handles BigInt serialization)
 */
export function outputJson(data: unknown): void {
  console.log(JSON.stringify({ success: true, data }, bigIntReplacer, 2))
}

/**
 * Output JSON error (for withExit handler)
 */
export function outputJsonError(message: string, code: string): void {
  console.log(JSON.stringify({ success: false, error: { message, code } }, bigIntReplacer, 2))
}

// ============================================================================
// Core Output Functions
// ============================================================================

/**
 * Print informational message - suppressed in silent mode
 */
export function info(message: string): void {
  if (!silentMode) {
    console.log(chalk.blue(message))
  }
}

/**
 * Print success message - suppressed in silent mode
 */
export function success(message: string): void {
  if (!silentMode) {
    console.log(chalk.green(`\n${message}`))
  }
}

/**
 * Print warning message - suppressed in silent mode
 */
export function warn(message: string): void {
  if (!silentMode) {
    console.log(chalk.yellow(message))
  }
}

/**
 * Print error message - always shown
 */
export function error(message: string): void {
  console.error(chalk.red(`\n${message}`))
}

/**
 * Print result data - always shown (this is the command output)
 */
export function printResult(message: string): void {
  console.log(message)
}

/**
 * Print table data - always shown (command output)
 */
export function printTable(data: object[]): void {
  console.table(data)
}

/**
 * Print error to stderr - always shown
 */
export function printError(message: string): void {
  console.error(chalk.red(message))
}

// ============================================================================
// Silent-Aware Spinner
// ============================================================================

export interface SilentAwareSpinner {
  text: string
  start(): SilentAwareSpinner
  stop(): SilentAwareSpinner
  succeed(text?: string): SilentAwareSpinner
  fail(text?: string): SilentAwareSpinner
  warn(text?: string): SilentAwareSpinner
  info(text?: string): SilentAwareSpinner
}

// Global set of active spinners for cleanup on cancellation
const activeSpinners = new Set<Ora | SilentAwareSpinner>()

/**
 * Stop all active spinners - called on Ctrl+C cancellation
 */
export function stopAllSpinners(): void {
  for (const spinner of activeSpinners) {
    spinner.stop()
  }
  activeSpinners.clear()
}

/**
 * No-op spinner for silent mode
 */
function createNoopSpinner(text: string): SilentAwareSpinner {
  const noopSpinner: SilentAwareSpinner = {
    text,
    start() {
      return this
    },
    stop() {
      activeSpinners.delete(this)
      return this
    },
    succeed() {
      activeSpinners.delete(this)
      return this
    },
    fail(text?: string) {
      activeSpinners.delete(this)
      // Errors are always shown
      if (text) printError(text)
      return this
    },
    warn() {
      activeSpinners.delete(this)
      return this
    },
    info() {
      activeSpinners.delete(this)
      return this
    },
  }
  return noopSpinner
}

/**
 * Wrap an ora spinner to track it for cleanup
 */
function wrapOraSpinner(spinner: Ora): Ora {
  const originalStop = spinner.stop.bind(spinner)
  const originalSucceed = spinner.succeed.bind(spinner)
  const originalFail = spinner.fail.bind(spinner)
  const originalWarn = spinner.warn.bind(spinner)
  const originalInfo = spinner.info.bind(spinner)

  spinner.stop = () => {
    activeSpinners.delete(spinner)
    return originalStop()
  }
  spinner.succeed = (text?: string) => {
    activeSpinners.delete(spinner)
    return originalSucceed(text)
  }
  spinner.fail = (text?: string) => {
    activeSpinners.delete(spinner)
    return originalFail(text)
  }
  spinner.warn = (text?: string) => {
    activeSpinners.delete(spinner)
    return originalWarn(text)
  }
  spinner.info = (text?: string) => {
    activeSpinners.delete(spinner)
    return originalInfo(text)
  }

  return spinner
}

/**
 * Create a spinner that respects silent mode
 * In silent mode, returns a no-op spinner (except fail() still prints)
 * All spinners are tracked globally for cleanup on cancellation
 */
export function createSpinner(text: string): SilentAwareSpinner | Ora {
  if (silentMode) {
    const spinner = createNoopSpinner(text)
    activeSpinners.add(spinner)
    return spinner
  }
  const spinner = wrapOraSpinner(ora(text).start())
  activeSpinners.add(spinner)
  return spinner
}
