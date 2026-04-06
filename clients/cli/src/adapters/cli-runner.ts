/**
 * CLI Runner - Wraps command execution for CLI mode
 *
 * Provides:
 * - Error handling with process exit
 * - Consistent exit codes
 * - Cleanup on completion
 */
import { classifyError, toErrorJson, VsigError } from '../core/errors'
import { isJsonOutput, printError } from '../lib/output'
import type { CLIContext } from './cli-context'

/**
 * Wrap a command handler with CLI exit behavior
 * - Exits with code 0 on success
 * - On VsigError: uses typed exitCode
 * - On unknown Error: classifies via classifyError(), then exits with typed code
 * - In JSON mode: outputs structured error JSON
 */
export function withExit<T extends any[]>(handler: (...args: T) => Promise<void>): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await handler(...args)
      process.exit(0)
    } catch (err: any) {
      const classified =
        err instanceof VsigError
          ? err
          : err instanceof Error
            ? classifyError(err)
            : classifyError(new Error(String(err)))

      if (isJsonOutput()) {
        process.stdout.write(`${JSON.stringify(toErrorJson(classified))}\n`)
        process.exit(classified.exitCode)
      }

      printError(`\nx ${classified.message}`)
      if (classified.hint) printError(`  hint: ${classified.hint}`)
      if (classified.suggestions?.length) {
        for (const s of classified.suggestions) printError(`  - ${s}`)
      }
      process.exit(classified.exitCode)
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
