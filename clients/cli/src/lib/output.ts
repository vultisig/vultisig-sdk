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
let nonInteractive = false
let quietMode = false
let fieldFilter: string[] | undefined

// ============================================================================
// Configuration
// ============================================================================

export function setSilentMode(silent: boolean): void {
  silentMode = silent
}

export function isSilent(): boolean {
  return silentMode
}

export function setNonInteractive(value: boolean): void {
  nonInteractive = value
}

export function isNonInteractive(): boolean {
  return nonInteractive
}

export function requireInteractive(hint: string): void {
  if (nonInteractive) {
    throw new Error(`Interactive prompt required but --non-interactive is set. ${hint}`)
  }
}

export function setQuiet(value: boolean): void {
  quietMode = value
}

export function setFields(fields: string[] | undefined): void {
  fieldFilter = fields
}

export function initOutputMode(options: { silent?: boolean; output?: string }): void {
  outputFormat = (options.output as OutputFormat) ?? 'table'
  silentMode = options.silent ?? process.env.VULTISIG_SILENT === '1'

  // JSON mode implies silent (no spinners, colors)
  if (outputFormat === 'json') {
    silentMode = true
  }
}

export function configureOutput(opts: {
  silent?: boolean
  format?: OutputFormat
  nonInteractive?: boolean
  quiet?: boolean
  fields?: string[]
}): void {
  if (opts.silent !== undefined) silentMode = opts.silent
  if (opts.format !== undefined) outputFormat = opts.format
  if (opts.nonInteractive !== undefined) nonInteractive = opts.nonInteractive
  if (opts.quiet !== undefined) quietMode = opts.quiet
  if (opts.fields !== undefined) fieldFilter = opts.fields

  if (outputFormat === 'json') silentMode = true
}

export function resetOutput(): void {
  silentMode = false
  outputFormat = 'table'
  nonInteractive = false
  quietMode = false
  fieldFilter = undefined
}

export function isJsonOutput(): boolean {
  return outputFormat === 'json'
}

export function getOutputFormat(): OutputFormat {
  return outputFormat
}

// ============================================================================
// Field Filtering & Quiet Mode
// ============================================================================

export function stripEmpty(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(stripEmpty)
  if (data !== null && typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>)
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => [k, stripEmpty(v)])
    )
  }
  return data
}

export function filterFields(data: unknown, fields: string[]): unknown {
  if (!fields.length) return data
  if (Array.isArray(data)) return data.map(item => filterFields(item, fields))
  if (data !== null && typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
    const matched = entries.filter(([k]) => fields.includes(k))
    if (matched.length > 0) return Object.fromEntries(matched)
    // No top-level keys match — recurse into ALL nested objects/arrays so fields like "amount" resolve inside { balances: [{amount}] }
    const recursed = entries.map(([k, v]) => [k, filterFields(v, fields)] as const)
    return Object.fromEntries(recursed)
  }
  return data
}

function collectKeys(data: unknown): Set<string> {
  const keys = new Set<string>()
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item !== null && typeof item === 'object') {
        for (const k of Object.keys(item as Record<string, unknown>)) keys.add(k)
      }
    }
  } else if (data !== null && typeof data === 'object') {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      keys.add(k)
      // Recurse into nested arrays and objects to find all reachable keys
      if (v !== null && typeof v === 'object') {
        for (const nested of collectKeys(v)) keys.add(nested)
      }
    }
  }
  return keys
}

function warnInvalidFields(data: unknown, fields: string[]): void {
  const available = collectKeys(data)
  if (available.size === 0) return
  const invalid = fields.filter(f => !available.has(f))
  if (invalid.length > 0) {
    process.stderr.write(`Warning: unknown field(s): ${invalid.join(', ')}. Available: ${[...available].join(', ')}\n`)
  }
}

export function applyOutputTransforms(data: unknown): unknown {
  let out = quietMode ? stripEmpty(data) : data
  if (fieldFilter?.length) {
    warnInvalidFields(out, fieldFilter)
    out = filterFields(out, fieldFilter)
  }
  return out
}

// ============================================================================
// JSON Output — v1 envelope: { success: boolean, v: 1, data | error }
// ============================================================================

function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

export function outputJson(data: unknown): void {
  const transformed = applyOutputTransforms(data)
  console.log(JSON.stringify({ success: true, v: 1, data: transformed }, bigIntReplacer, 2))
}

export function outputErrorJson(errJson: unknown): void {
  const transformed = applyOutputTransforms(errJson)
  console.log(JSON.stringify(transformed, bigIntReplacer, 2))
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
  const spinner = wrapOraSpinner(ora({ text, stream: process.stderr }).start())
  activeSpinners.add(spinner)
  return spinner
}
