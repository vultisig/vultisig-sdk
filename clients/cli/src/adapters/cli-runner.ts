// CLI Runner - Wraps command execution with typed error handling and exit codes

import { classifyError, toErrorJson, VsigError } from '../core/errors'
import { isJsonOutput, outputErrorJson, printError } from '../lib/output'

// Wrap a command handler with CLI exit behavior
// On VsigError: uses typed exitCode
// On unknown Error: classifies via classifyError(), then exits with typed code
// In JSON mode: outputs structured error JSON with versioned envelope
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
        outputErrorJson(toErrorJson(classified))
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
