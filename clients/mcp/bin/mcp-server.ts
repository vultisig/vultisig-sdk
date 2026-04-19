#!/usr/bin/env node

// MCP stdio requires stdout exclusively for JSON-RPC — redirect logs before any SDK imports
const toStderr = (...args: unknown[]) => {
  process.stderr.write(args.map(String).join(' ') + '\n')
}
console.log = toStderr
console.info = toStderr
console.warn = toStderr

import { readFileSync } from 'node:fs'

import { executeAuthSetup, getServerPassword } from '@vultisig/client-shared'
import { Vultisig } from '@vultisig/sdk'

import type { Profile } from '../src/index.js'
import { startMcpServer } from '../src/index.js'

const PROFILES = ['harness', 'defi'] as const

function parseArgs(): { profile: Profile; vaultId?: string; vaultFile?: string; setup?: boolean } {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    process.stderr.write(`
vultisig-mcp — MCP server for Vultisig wallet operations

SETUP (first time):
  vmcp --setup            Import a vault and store credentials interactively
  vmcp --setup --vault-file <path>   Import a specific vault file

USAGE:
  vmcp [options]

OPTIONS:
  --profile <harness|defi>   Tool profile (default: defi)
                             harness = read-only tools only
                             defi    = all tools including send/swap
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
  vmcp --profile harness

  # Claude Code integration:
  claude mcp add vultisig -- vmcp
  claude mcp add vultisig -- npx @vultisig/mcp

  # CI / headless:
  VAULT_PASSWORD=xxx vmcp --vault-file ./vault.vult
`)
    process.exit(0)
  }

  let profile: Profile = 'defi'
  let vaultId: string | undefined
  let vaultFile: string | undefined
  const setup = args.includes('--setup')

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--profile' && args[i + 1]) {
      const value = args[++i] as Profile
      if (!PROFILES.includes(value)) {
        process.stderr.write(`Invalid profile "${value}". Must be one of: ${PROFILES.join(', ')}\n`)
        process.exit(1)
      }
      profile = value
    } else if (arg === '--vault-id' && args[i + 1]) {
      vaultId = args[++i]
    } else if (arg === '--vault-file' && args[i + 1]) {
      vaultFile = args[++i]
    }
  }

  return { profile, vaultId, vaultFile, setup }
}

async function runSetup(vaultFile?: string): Promise<void> {
  // During setup, restore stdout for interactive prompts
  console.log = process.stdout.write.bind(process.stdout)

  process.stderr.write('[vultisig-mcp] Running auth setup...\n')
  const result = await executeAuthSetup({ vaultFile })
  process.stderr.write(
    `[vultisig-mcp] Auth complete: vault "${result.vaultName}" (${result.storageBackend})\n` +
      `[vultisig-mcp] You can now start the server with: vmcp\n`
  )
}

async function main() {
  const { profile, vaultId, vaultFile, setup } = parseArgs()

  if (setup) {
    await runSetup(vaultFile)
    return
  }

  const sdk = new Vultisig({
    onPasswordRequired: async (vaultId: string) => {
      const password = await getServerPassword(vaultId)
      if (!password) throw new Error('No server password found. Run: vmcp --setup')
      return password
    },
  })
  await sdk.initialize()

  let vault
  if (vaultFile) {
    process.stderr.write(`[vultisig-mcp] Loading vault from file: ${vaultFile}\n`)
    const content = readFileSync(vaultFile, 'utf-8')
    vault = await sdk.importVault(content)
  } else {
    const vaults = await sdk.listVaults()
    if (vaultId) {
      vault = vaults.find(v => v.id === vaultId)
      if (!vault) {
        const available = vaults.map(v => `  - ${v.id} (${v.name})`).join('\n')
        process.stderr.write(
          `Vault "${vaultId}" not found.\n\n` +
            (vaults.length
              ? `Available vaults:\n${available}\n`
              : `No vaults imported. Run this first:\n  vmcp --setup\n`)
        )
        process.exit(1)
      }
    } else {
      vault = vaults[0]
      if (!vault) {
        process.stderr.write(
          `No vaults found. You need to set up auth before starting the MCP server.\n\n` +
            `Run:\n` +
            `  vmcp --setup\n\n` +
            `For CI/headless environments, use --vault-file instead:\n` +
            `  VAULT_PASSWORD=xxx vmcp --vault-file ./vault.vult\n\n` +
            `Run vmcp --help for more options.\n`
        )
        process.exit(1)
      }
    }
  }

  process.stderr.write(`[vultisig-mcp] Vault loaded: ${vault.name} (${vault.type})\n`)
  process.stderr.write(`[vultisig-mcp] Profile: ${profile} | Tools: ${profile === 'harness' ? 'read-only' : 'all'}\n`)

  // VaultBase is structurally compatible with Vault but TS can't verify
  // due to branded Chain types vs plain strings in the Vault interface
  await startMcpServer(vault as any, profile)
}

main().catch(err => {
  process.stderr.write(`${err}\n`)
  process.exit(1)
})
