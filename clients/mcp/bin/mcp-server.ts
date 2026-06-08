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

import { formatMcpHelp, parseMcpArgs } from '../src/args.js'
import { startMcpServer } from '../src/index.js'

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
  const { profile, vaultId, vaultFile, setup, help } = parseMcpArgs(process.argv.slice(2))

  if (help) {
    process.stderr.write(formatMcpHelp())
    return
  }

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
  process.stderr.write(`${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
