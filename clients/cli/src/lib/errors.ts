/**
 * Structured Error Handling for Vultisig CLI
 *
 * Provides consistent exit codes and user-friendly error messages
 */
import chalk from 'chalk'

/**
 * Exit codes for the CLI
 */
export enum ExitCode {
  SUCCESS = 0,
  GENERAL_ERROR = 1,
  INVALID_USAGE = 2,
  CONFIG_ERROR = 3,
  AUTH_ERROR = 4,
  NETWORK_ERROR = 5,
  VAULT_ERROR = 6,
  TRANSACTION_ERROR = 7,
}

/**
 * Error names mapped to exit codes
 */
const ERROR_CODE_MAP: Record<string, ExitCode> = {
  INVALID_USAGE: ExitCode.INVALID_USAGE,
  CONFIG_ERROR: ExitCode.CONFIG_ERROR,
  AUTH_ERROR: ExitCode.AUTH_ERROR,
  NETWORK_ERROR: ExitCode.NETWORK_ERROR,
  VAULT_ERROR: ExitCode.VAULT_ERROR,
  TRANSACTION_ERROR: ExitCode.TRANSACTION_ERROR,
}

/**
 * CLI Error with structured information
 */
export class CLIError extends Error {
  public readonly code: ExitCode
  public readonly suggestions: string[]
  public readonly debugInfo?: string

  constructor(
    message: string,
    options: {
      code?: ExitCode
      suggestions?: string[]
      debugInfo?: string
      cause?: Error
    } = {}
  ) {
    super(message)
    this.name = 'CLIError'
    this.code = options.code ?? ExitCode.GENERAL_ERROR
    this.suggestions = options.suggestions ?? []
    this.debugInfo = options.debugInfo
    if (options.cause) {
      this.cause = options.cause
    }
  }

  /**
   * Format error for display
   */
  format(debug = false): string {
    const lines: string[] = []

    lines.push(chalk.red(`Error: ${this.message}`))
    lines.push('')

    if (this.suggestions.length > 0) {
      lines.push('  Suggestions:')
      for (const suggestion of this.suggestions) {
        lines.push(chalk.yellow(`    - ${suggestion}`))
      }
      lines.push('')
    }

    if (debug && this.cause instanceof Error) {
      lines.push(chalk.gray('  Stack trace:'))
      lines.push(chalk.gray(`    ${this.cause.stack?.replace(/\n/g, '\n    ')}`))
      lines.push('')
    }

    const codeName = Object.entries(ERROR_CODE_MAP).find(([, v]) => v === this.code)?.[0] ?? 'GENERAL_ERROR'
    lines.push(chalk.gray(`  Debug info: ${codeName} (code: ${this.code})`))

    return lines.join('\n')
  }
}

/**
 * Error factory functions for common error types
 */
export const Errors = {
  invalidUsage(message: string, suggestions?: string[]): CLIError {
    return new CLIError(message, {
      code: ExitCode.INVALID_USAGE,
      suggestions: suggestions ?? ['Run "vultisig --help" for usage information'],
    })
  },

  configError(message: string, suggestions?: string[]): CLIError {
    return new CLIError(message, {
      code: ExitCode.CONFIG_ERROR,
      suggestions: suggestions ?? ['Check your configuration in ~/.vultisig/config.json'],
    })
  },

  authError(message: string, suggestions?: string[]): CLIError {
    return new CLIError(message, {
      code: ExitCode.AUTH_ERROR,
      suggestions: suggestions ?? ['Double-check your password', 'Use "vultisig vaults" to verify the vault ID'],
    })
  },

  networkError(message: string, cause?: Error): CLIError {
    return new CLIError(message, {
      code: ExitCode.NETWORK_ERROR,
      suggestions: [
        'Check your internet connection',
        'Try again in a few moments',
        'Run "vultisig server" to check connectivity',
      ],
      cause,
    })
  },

  vaultError(message: string, suggestions?: string[]): CLIError {
    return new CLIError(message, {
      code: ExitCode.VAULT_ERROR,
      suggestions: suggestions ?? [
        'Use "vultisig vaults" to list available vaults',
        'Create a vault with "vultisig create"',
      ],
    })
  },

  transactionError(message: string, cause?: Error): CLIError {
    return new CLIError(message, {
      code: ExitCode.TRANSACTION_ERROR,
      suggestions: [
        'Check your balance with "vultisig balance"',
        'Verify the recipient address',
        'Ensure you have enough for gas fees',
      ],
      cause,
    })
  },
}

/**
 * Check if an error is a CLIError
 */
export function isCLIError(error: unknown): error is CLIError {
  return error instanceof CLIError
}

/**
 * Get exit code from an error
 */
export function getExitCode(error: unknown): ExitCode {
  if (isCLIError(error)) {
    return error.code
  }
  if (error instanceof Error && 'exitCode' in error) {
    return (error as any).exitCode
  }
  return ExitCode.GENERAL_ERROR
}

/**
 * Format any error for display
 */
export function formatError(error: unknown, debug = false): string {
  if (isCLIError(error)) {
    return error.format(debug)
  }
  if (error instanceof Error) {
    const lines = [chalk.red(`Error: ${error.message}`)]
    if (debug && error.stack) {
      lines.push('')
      lines.push(chalk.gray('  Stack trace:'))
      lines.push(chalk.gray(`    ${error.stack.replace(/\n/g, '\n    ')}`))
    }
    return lines.join('\n')
  }
  return chalk.red(`Error: ${String(error)}`)
}
