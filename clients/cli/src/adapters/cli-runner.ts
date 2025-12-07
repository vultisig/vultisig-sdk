/**
 * CLI Runner - Wraps command execution for CLI mode
 *
 * Provides:
 * - Error handling with process exit
 * - Consistent exit codes
 * - Cleanup on completion
 */
import { isJsonOutput, outputJsonError, printError } from '../lib/output'
import type { CLIContext } from './cli-context'

/**
 * Wrap a command handler with CLI exit behavior
 * - Exits with code 0 on success
 * - Exits with code 1 on error (or custom exitCode)
 */
export function withExit<T extends any[]>(handler: (...args: T) => Promise<void>): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await handler(...args)
      process.exit(0)
    } catch (err: any) {
      const exitCode = err.exitCode ?? 1

      // In JSON mode, output structured error
      if (isJsonOutput()) {
        outputJsonError(err.message, err.code ?? 'GENERAL_ERROR')
        process.exit(exitCode)
      }

      if (err.exitCode !== undefined) {
        process.exit(err.exitCode)
      }
      printError(`\nx ${err.message}`)
      process.exit(1)
    }
  }
}

/**
 * Run a command with context and automatic cleanup
 */
export async function runCommand<T>(ctx: CLIContext, handler: () => Promise<T>): Promise<T> {
  try {
    return await handler()
  } finally {
    // Context cleanup happens in the withExit wrapper
  }
}
