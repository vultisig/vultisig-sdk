/**
 * Output Service - Centralized console output with silent mode support
 *
 * In silent mode, only results and errors are shown.
 * Informational messages, spinners, and success/warn messages are suppressed.
 */
import chalk from 'chalk'
import ora, { type Ora } from 'ora'

// ============================================================================
// State
// ============================================================================

let silentMode = false

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
export function initOutputMode(options: { silent?: boolean }): void {
  silentMode = options.silent ?? process.env.VULTISIG_SILENT === '1'
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
      return this
    },
    succeed() {
      return this
    },
    fail(text?: string) {
      // Errors are always shown
      if (text) printError(text)
      return this
    },
    warn() {
      return this
    },
    info() {
      return this
    },
  }
  return noopSpinner
}

/**
 * Create a spinner that respects silent mode
 * In silent mode, returns a no-op spinner (except fail() still prints)
 */
export function createSpinner(text: string): SilentAwareSpinner | Ora {
  if (silentMode) {
    return createNoopSpinner(text)
  }
  return ora(text).start()
}
