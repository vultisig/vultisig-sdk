#!/usr/bin/env node
import { readFileSync } from 'node:fs'

import { Vultisig } from '@vultisig/sdk'

import type { Profile } from '../src/index.js'
import { startMcpServer } from '../src/index.js'

const PROFILES = ['harness', 'defi', 'full'] as const

function parseArgs(): { profile: Profile; vaultId?: string; vaultFile?: string } {
  const args = process.argv.slice(2)
  let profile: Profile = 'defi'
  let vaultId: string | undefined
  let vaultFile: string | undefined

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

  return { profile, vaultId, vaultFile }
}

async function main() {
  const { profile, vaultId, vaultFile } = parseArgs()

  const sdk = new Vultisig()
  await sdk.initialize()

  let vault
  if (vaultFile) {
    const content = readFileSync(vaultFile, 'utf-8')
    vault = await sdk.importVault(content)
  } else {
    const vaults = await sdk.listVaults()
    if (vaultId) {
      vault = vaults.find(v => v.id === vaultId)
      if (!vault) {
        process.stderr.write(`Vault "${vaultId}" not found.\n`)
        process.exit(1)
      }
    } else {
      vault = vaults[0]
      if (!vault) {
        process.stderr.write('No vaults found. Use --vault-file to provide a .vult file.\n')
        process.exit(1)
      }
    }
  }

  await startMcpServer(vault, profile)
}

main().catch(err => {
  process.stderr.write(`${err}\n`)
  process.exit(1)
})
