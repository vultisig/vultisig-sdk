import type { Profile } from './tools.js'

const PROFILES = ['harness', 'defi'] as const

export type McpServerArgs = {
  profile: Profile
  vaultId?: string
  vaultFile?: string
  setup?: boolean
  help?: boolean
}

export function formatMcpHelp(): string {
  return `
vultisig-mcp - MCP server for Vultisig wallet operations

SETUP (first time):
  vmcp --setup                    Import a vault and store credentials interactively
  vmcp --setup --vault-file <path>   Import a specific vault file
  vmcp --setup --vault <path>        Import a specific vault file

USAGE:
  vmcp [options]

OPTIONS:
  --profile <harness|defi>   Tool profile (default: defi)
                             harness = read-only tools only
                             defi    = all tools including send/swap
  --vault <id-or-path>       Use a vault by ID, or load a path-like/.vult file
  --vault-id <id>            Use a specific vault (default: first found)
  --setup                    Run interactive auth setup, then exit

CI / HEADLESS (skip interactive auth):
  --vault-file <path>        Load vault directly from a .vult file
                             Requires VAULT_PASSWORD and/or VAULT_DECRYPT_PASSWORD
                             environment variables for encrypted vaults

EXAMPLES:
  # First time setup:
  vmcp --setup

  # Start the server:
  vmcp
  vmcp --vault my-vault-id
  vmcp --profile harness

  # Claude Code integration:
  claude mcp add vultisig -- vmcp
  claude mcp add vultisig -- npx @vultisig/mcp

  # CI / headless:
  VAULT_PASSWORD=xxx vmcp --vault-file ./vault.vult
`
}

export function parseMcpArgs(args: string[]): McpServerArgs {
  let profile: Profile = 'defi'
  let vaultId: string | undefined
  let vaultFile: string | undefined
  let setup = false

  const assignVaultId = (value: string) => {
    if (vaultId || vaultFile) {
      throw new Error('Specify only one of --vault, --vault-id, or --vault-file.')
    }
    vaultId = value
  }

  const assignVaultFile = (value: string) => {
    if (vaultId || vaultFile) {
      throw new Error('Specify only one of --vault, --vault-id, or --vault-file.')
    }
    vaultFile = value
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--help' || arg === '-h') {
      return { profile, help: true }
    }

    if (arg === '--setup') {
      setup = true
      continue
    }

    if (arg === '--profile') {
      const value = readOptionValue(args, i, arg) as Profile
      i++
      if (!PROFILES.includes(value)) {
        throw new Error(`Invalid profile "${value}". Must be one of: ${PROFILES.join(', ')}.`)
      }
      profile = value
      continue
    }

    if (arg === '--vault-id') {
      assignVaultId(readOptionValue(args, i, arg))
      i++
      continue
    }

    if (arg === '--vault-file') {
      assignVaultFile(readOptionValue(args, i, arg))
      i++
      continue
    }

    if (arg === '--vault') {
      const value = readOptionValue(args, i, arg)
      i++
      if (isVaultFileValue(value)) {
        assignVaultFile(value)
      } else {
        assignVaultId(value)
      }
      continue
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option "${arg}".`)
    }

    throw new Error(`Unexpected argument "${arg}".`)
  }

  if (setup && vaultId) {
    throw new Error('Setup can only import a vault file. Use --vault-file <path> or --vault <path>.')
  }

  return { profile, vaultId, vaultFile, setup }
}

function readOptionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${option}.`)
  }
  return value
}

function isVaultFileValue(value: string): boolean {
  return value.endsWith('.vult') || value.includes('/') || value.includes('\\') || value.startsWith('~')
}
