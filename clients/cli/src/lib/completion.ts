/**
 * Shell Completion for Vultisig CLI
 *
 * Provides tab completion for bash, zsh, and fish shells using tabtab
 */
import { SUPPORTED_CHAINS } from '@vultisig/sdk'
import { type Command, program } from 'commander'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

import { ExitCode } from '../core/errors'
import { isNonInteractive } from './output'

// Import tabtab dynamically to handle ESM/CJS differences
let tabtab: any = null

async function getTabtab() {
  if (!tabtab) {
    try {
      tabtab = await import('tabtab')
      // Handle default export
      if (tabtab.default) {
        tabtab = tabtab.default
      }
    } catch {
      return null
    }
  }
  return tabtab
}

/**
 * Command names for completion, read from Commander itself.
 *
 * These lists used to be hand-maintained and had drifted badly: the command array
 * was missing sign/broadcast/tx-status/execute/discount/agent/auth/delete/join/
 * rujira/add-mldsa, and the chain list was a hand-picked subset. Reading the real
 * registries means completion cannot go stale again when a command or chain is added.
 *
 * Resolved lazily rather than at module load: `program` is Commander's singleton and
 * the CLI registers its commands as its module body runs, so the list is only complete
 * once that has happened — every caller here runs after it.
 */
function getCommands(): string[] {
  return program.commands.map(cmd => cmd.name()).sort()
}

/** Chain names for completion, from the SDK's chain registry. */
function getChains(): string[] {
  return [...SUPPORTED_CHAINS]
}

/**
 * Get stored vault names for completion
 */
function getVaultNames(): string[] {
  try {
    const vaultDir = join(homedir(), '.vultisig', 'vaults')
    if (!existsSync(vaultDir)) return []

    // Read vault files and extract names
    const files = readdirSync(vaultDir) as string[]
    const names: string[] = []

    for (const file of files) {
      if (file.startsWith('vault:') && file.endsWith('.json')) {
        try {
          const content = readFileSync(join(vaultDir, file), 'utf-8')
          const vault = JSON.parse(content)
          if (vault.name) names.push(vault.name)
          if (vault.id) names.push(vault.id)
        } catch {
          // Skip invalid vault files
        }
      }
    }

    return names
  } catch {
    return []
  }
}

/**
 * Handle completion requests from the shell
 */
export async function handleCompletion(): Promise<boolean> {
  const tt = await getTabtab()
  if (!tt) return false

  const env = tt.parseEnv(process.env)
  if (!env.complete) return false

  const { line, lastPartial } = env

  // Parse the command line
  const parts = line.split(/\s+/).filter(Boolean)
  const cmd = parts[1] // parts[0] is 'vultisig'

  let completions: string[] = []

  if (!cmd || parts.length === 1 || (parts.length === 2 && lastPartial)) {
    // Complete command names
    completions = getCommands().filter(c => c.startsWith(lastPartial || ''))
  } else {
    // Command-specific completions
    switch (cmd) {
      case 'balance':
      case 'tokens':
      case 'send':
        // Complete chain names
        if (parts.length === 2 || (parts.length === 3 && lastPartial)) {
          completions = getChains().filter(c => c.toLowerCase().startsWith((lastPartial || '').toLowerCase()))
        }
        break

      case 'switch':
      case 'verify':
        // Complete vault names/IDs
        if (parts.length === 2 || (parts.length === 3 && lastPartial)) {
          completions = getVaultNames().filter(n => n.toLowerCase().startsWith((lastPartial || '').toLowerCase()))
        }
        break

      case 'import':
      case 'export':
        // File path completion (handled by shell)
        break

      case 'chains':
        // Complete with --add or --remove
        if (lastPartial?.startsWith('-')) {
          completions = ['--add', '--remove'].filter(o => o.startsWith(lastPartial))
        } else if (parts.includes('--add') || parts.includes('--remove')) {
          completions = getChains().filter(c => c.toLowerCase().startsWith((lastPartial || '').toLowerCase()))
        }
        break

      case 'swap':
      case 'swap-quote':
        // Complete chain names for from/to
        if (parts.length <= 3 || (parts.length === 4 && lastPartial)) {
          completions = getChains().filter(c => c.toLowerCase().startsWith((lastPartial || '').toLowerCase()))
        }
        break

      case 'completion':
        // Complete shell types
        if (parts.length === 2 || (parts.length === 3 && lastPartial)) {
          completions = ['install', 'uninstall', 'bash', 'zsh', 'fish'].filter(s =>
            s.startsWith((lastPartial || '').toLowerCase())
          )
        }
        break
    }
  }

  // Add common flags if starting with -
  if (lastPartial?.startsWith('-')) {
    const flags = ['-h', '--help', '-v', '--version', '-i', '--interactive', '--debug']
    completions = [...completions, ...flags.filter(f => f.startsWith(lastPartial))]
  }

  if (completions.length > 0) {
    tt.log(completions)
  }

  return true
}

/**
 * Setup completion command on the program
 */
export function setupCompletionCommand(program: Command): void {
  program
    .command('completion [shell]')
    .description('Generate shell completion scripts')
    .option('--install', 'Install completion for current shell')
    .option('--uninstall', 'Remove completion scripts')
    .action(async (shell: string | undefined, options: { install?: boolean; uninstall?: boolean }) => {
      const tt = await getTabtab()

      if (!tt) {
        console.error('Shell completion is not available. Install tabtab: npm install -g tabtab')
        process.exit(1)
      }

      if (options.install) {
        // tabtab's installer prompts (via readline) for which shell to target.
        // With a non-TTY stdin that readline closes immediately and throws a raw
        // ERR_USE_AFTER_CLOSE stack trace — fail closed with a clear message instead.
        // Uses the shared non-interactive definition (non-TTY stdout OR stdin, or
        // --non-interactive/--ci), not just stdin: with redirected stdout the
        // installer's prompt would land on the machine-output channel.
        if (isNonInteractive()) {
          console.error(
            'completion --install needs an interactive terminal to pick your shell.\n' +
              'Run it directly in your shell, or append the script manually, e.g.:\n' +
              '  vultisig completion bash >> ~/.bashrc\n' +
              '  vultisig completion zsh  >> ~/.zshrc'
          )
          process.exit(ExitCode.CONFIRMATION_REQUIRED)
        }
        try {
          await tt.install({
            name: 'vultisig',
            completer: 'vultisig',
          })
          await tt.install({
            name: 'vsig',
            completer: 'vsig',
          })
          console.log('Shell completion installed successfully for vultisig and vsig!')
          console.log('Restart your shell or run: source ~/.bashrc (or ~/.zshrc)')
        } catch (err: any) {
          console.error(`Failed to install completion: ${err.message}`)
          process.exit(1)
        }
        return
      }

      if (options.uninstall) {
        try {
          await tt.uninstall({
            name: 'vultisig',
          })
          await tt.uninstall({
            name: 'vsig',
          })
          console.log('Shell completion uninstalled successfully!')
        } catch (err: any) {
          console.error(`Failed to uninstall completion: ${err.message}`)
          process.exit(1)
        }
        return
      }

      // Print completion script for specified shell
      if (shell) {
        const scripts: Record<string, string> = {
          bash: getBashCompletionScript(),
          zsh: getZshCompletionScript(),
          fish: getFishCompletionScript(),
        }

        const script = scripts[shell.toLowerCase()]
        if (script) {
          console.log(script)
        } else {
          console.error(`Unknown shell: ${shell}. Supported: bash, zsh, fish`)
          process.exit(1)
        }
        return
      }

      // Show help
      console.log('Usage: vultisig completion [shell] [options]')
      console.log('')
      console.log('Generate shell completion scripts')
      console.log('')
      console.log('Arguments:')
      console.log('  shell          Shell type: bash, zsh, fish')
      console.log('')
      console.log('Options:')
      console.log('  --install      Install completion for current shell')
      console.log('  --uninstall    Remove completion scripts')
      console.log('')
      console.log('Examples:')
      console.log('  vultisig completion --install')
      console.log('  vultisig completion bash >> ~/.bashrc')
      console.log('  vultisig completion zsh >> ~/.zshrc')
    })
}

/**
 * Bash completion script
 */
function getBashCompletionScript(): string {
  return `
# vultisig bash completion
_vultisig_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local cmd="\${COMP_WORDS[1]}"

  if [ "\${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=($(compgen -W "${getCommands().join(' ')}" -- "\${cur}"))
    return
  fi

  case "\${cmd}" in
    balance|tokens|send)
      COMPREPLY=($(compgen -W "${getChains().join(' ')}" -- "\${cur}"))
      ;;
    chains)
      COMPREPLY=($(compgen -W "--add --remove ${getChains().join(' ')}" -- "\${cur}"))
      ;;
    swap|swap-quote)
      COMPREPLY=($(compgen -W "${getChains().join(' ')}" -- "\${cur}"))
      ;;
    completion)
      COMPREPLY=($(compgen -W "install uninstall bash zsh fish" -- "\${cur}"))
      ;;
    import|export)
      COMPREPLY=($(compgen -f -- "\${cur}"))
      ;;
    *)
      COMPREPLY=($(compgen -W "-h --help" -- "\${cur}"))
      ;;
  esac
}

complete -F _vultisig_completions vultisig
complete -F _vultisig_completions vsig
`.trim()
}

/**
 * Zsh completion script
 */
function getZshCompletionScript(): string {
  return `
#compdef vultisig vsig

_vultisig() {
  local -a commands chains
  commands=(${getCommands()
    .map(c => `'${c}:${c} command'`)
    .join(' ')})
  chains=(${getChains().join(' ')})

  _arguments -C \\
    '1: :->command' \\
    '*: :->args'

  case "$state" in
    command)
      _describe 'command' commands
      ;;
    args)
      case "$words[2]" in
        balance|tokens|send|swap|swap-quote)
          _describe 'chain' chains
          ;;
        completion)
          _describe 'shell' '(install uninstall bash zsh fish)'
          ;;
        import|export)
          _files
          ;;
      esac
      ;;
  esac
}

_vultisig
`.trim()
}

/**
 * Fish completion script
 */
function getFishCompletionScript(): string {
  // Generate completions for both vultisig and vsig
  const commands = ['vultisig', 'vsig']
  const commandCompletions = commands
    .flatMap(cmd => getCommands().map(c => `complete -c ${cmd} -n "__fish_use_subcommand" -a "${c}"`))
    .join('\n')
  const chainCompletions = commands
    .flatMap(cmd =>
      getChains().map(
        c => `complete -c ${cmd} -n "__fish_seen_subcommand_from balance tokens send swap swap-quote" -a "${c}"`
      )
    )
    .join('\n')

  return `
# vultisig/vsig fish completion
${commandCompletions}
${chainCompletions}
complete -c vultisig -n "__fish_seen_subcommand_from completion" -a "install uninstall bash zsh fish"
complete -c vsig -n "__fish_seen_subcommand_from completion" -a "install uninstall bash zsh fish"
complete -c vultisig -n "__fish_seen_subcommand_from import export" -a "(__fish_complete_path)"
complete -c vsig -n "__fish_seen_subcommand_from import export" -a "(__fish_complete_path)"
`.trim()
}
