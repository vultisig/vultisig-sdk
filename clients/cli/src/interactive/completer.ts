/**
 * Tab Completion - Provides intelligent tab completion for the shell
 */
import { Chain } from '@vultisig/sdk'
import fs from 'fs'
import path from 'path'

import type { ShellContext } from './shell-context'

/**
 * All available shell commands
 */
const COMMANDS = [
  // Vault management
  'vaults',
  'vault',
  'import',
  'create',
  'info',
  'export',
  // Wallet operations
  'balance',
  'bal',
  'send',
  'portfolio',
  'addresses',
  'chains',
  'tokens',
  // Swap operations
  'swap-chains',
  'swap-quote',
  'swap',
  // Session commands (shell-only)
  'lock',
  'unlock',
  'status',
  // Settings
  'currency',
  'server',
  'address-book',
  // Help
  'help',
  '?',
  // REPL commands
  '.help',
  '.clear',
  '.exit',
]

/**
 * Create a completer function for the REPL
 */
export function createCompleter(ctx: ShellContext) {
  return function completer(line: string): [string[], string] {
    try {
      const parts = line.split(/\s+/)
      const command = parts[0]?.toLowerCase()

      // File path completion for import/export
      if ((command === 'import' || command === 'export') && parts.length > 1) {
        const partial = parts.slice(1).join(' ')
        return completeFilePath(partial, command === 'import')
      }

      // Vault name completion
      if (command === 'vault' && parts.length > 1) {
        const partial = parts.slice(1).join(' ')
        return completeVaultName(ctx, partial)
      }

      // Chain completion for chains --add/--remove
      if (command === 'chains' && parts.length >= 2) {
        const flag = parts[parts.length - 2]?.toLowerCase()
        if (flag === '--add' || flag === '--remove') {
          const partial = parts[parts.length - 1] || ''
          return completeChainName(partial)
        }
        if (
          parts[parts.length - 1]?.toLowerCase() === '--add' ||
          parts[parts.length - 1]?.toLowerCase() === '--remove'
        ) {
          return completeChainName('')
        }
      }

      // Chain completion for balance, tokens, send, swap commands
      if (['balance', 'bal', 'tokens', 'send', 'swap', 'swap-quote'].includes(command) && parts.length === 2) {
        const partial = parts[1] || ''
        return completeChainName(partial)
      }

      // Command completion
      const hits = COMMANDS.filter(c => c.startsWith(line))
      const show = hits.length ? hits : COMMANDS
      return [show, line]
    } catch {
      return [[], line]
    }
  }
}

/**
 * Complete file paths
 */
function completeFilePath(partial: string, filterVult: boolean): [string[], string] {
  try {
    const endsWithSeparator = partial.endsWith('/') || partial.endsWith(path.sep)

    let dir: string
    let basename: string

    if (endsWithSeparator) {
      dir = partial
      basename = ''
    } else {
      dir = path.dirname(partial)
      basename = path.basename(partial)

      if (fs.existsSync(partial) && fs.statSync(partial).isDirectory()) {
        dir = partial
        basename = ''
      }
    }

    const resolvedDir = path.resolve(dir)

    if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
      return [[], partial]
    }

    const files = fs.readdirSync(resolvedDir)

    const matches = files
      .filter((file: string) => file.startsWith(basename))
      .map((file: string) => {
        const fullPath = path.join(dir, file)
        const stats = fs.statSync(path.join(resolvedDir, file))

        if (stats.isDirectory()) {
          return fullPath + '/'
        }

        if (filterVult) {
          if (file.endsWith('.vult') || stats.isDirectory()) {
            return fullPath
          }
          return null
        }

        return fullPath
      })
      .filter((item): item is string => item !== null)

    return [matches, partial]
  } catch {
    return [[], partial]
  }
}

/**
 * Complete vault names (case-insensitive)
 */
function completeVaultName(ctx: ShellContext, partial: string): [string[], string] {
  const vaultNames = Array.from(ctx.getVaults().values()).map(vault => vault.name)
  const partialLower = partial.toLowerCase()
  const matches = vaultNames.filter((name: string) => name.toLowerCase().startsWith(partialLower))
  matches.sort()
  const show = matches.length > 0 ? matches : vaultNames.sort()
  return [show, partial]
}

/**
 * Complete chain names (case-insensitive)
 */
function completeChainName(partial: string): [string[], string] {
  const allChains = Object.values(Chain) as string[]
  const partialLower = partial.toLowerCase()
  const matches = allChains.filter((chain: string) => chain.toLowerCase().startsWith(partialLower))
  matches.sort()
  const show = matches.length > 0 ? matches : allChains.sort()
  return [show, partial]
}

/**
 * Find a chain by name (case-insensitive)
 */
export function findChainByName(name: string): Chain | null {
  const allChains = Object.values(Chain) as string[]
  const nameLower = name.toLowerCase()
  const found = allChains.find((chain: string) => chain.toLowerCase() === nameLower)
  return found ? (found as Chain) : null
}
