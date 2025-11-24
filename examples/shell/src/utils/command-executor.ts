import chalk from 'chalk'

/**
 * Centralized command execution wrapper with consistent error handling.
 * Eliminates the need for try-catch blocks scattered throughout command methods.
 */
export class CommandExecutor {
  /**
   * Execute a command function with centralized error handling.
   *
   * @param commandFn - The async command function to execute
   * @param errorContext - Optional context string to prepend to error messages
   * @returns The result of the command function, or null if an error occurred
   */
  async execute<T>(commandFn: () => Promise<T>, errorContext?: string): Promise<T | null> {
    try {
      return await commandFn()
    } catch (error: any) {
      const context = errorContext ? `${errorContext}: ` : ''
      console.error(chalk.red(`✗ ${context}${error.message}`))

      // Log stack trace in verbose mode if needed
      if (process.env.DEBUG) {
        console.error(chalk.gray(error.stack))
      }

      return null
    }
  }
}
