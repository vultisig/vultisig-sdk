/**
 * CLI Context - CommandContext implementation for CLI mode
 *
 * In CLI mode:
 * - Each command runs once and exits
 * - Passwords are retrieved from env vars or prompted
 * - No password caching between commands (stateless)
 */
import type { Vultisig } from '@vultisig/sdk/node'

import { BaseCommandContext } from '../core/command-context'
import { getPassword } from '../core/password-manager'

/**
 * CLI-specific implementation of CommandContext
 */
export class CLIContext extends BaseCommandContext {
  get isInteractive(): boolean {
    return false
  }

  /**
   * Get password for a vault
   * In CLI mode, we check env vars first, then prompt
   * No caching since each command runs independently
   */
  async getPassword(vaultId: string, vaultName?: string): Promise<string> {
    return getPassword(vaultId, vaultName)
  }
}

/**
 * Create a CLI context from an initialized SDK
 */
export function createCLIContext(sdk: Vultisig): CLIContext {
  return new CLIContext(sdk)
}
