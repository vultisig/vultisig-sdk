#!/usr/bin/env tsx

import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

import { deriveQbtcAddress } from '@vultisig/core-chain/publicKey/address/deriveQbtcAddress'
import { FastVault, MemoryStorage, Vultisig } from '@vultisig/sdk'

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i]?.startsWith('--') && args[i + 1]) {
      result[args[i]!.slice(2)] = args[i + 1]!
      i++
    }
  }
  return result
}

function printUsage(): void {
  console.error(`Usage:
  npx tsx scripts/add-mldsa-to-vault.ts --vault <path> --password <password> --email <email> [--output <path>]

  --output defaults to the input vault path (overwrite).
  Env: VULTISIG_API_URL, VULTISIG_ROUTER_URL (optional)`)
}

async function main(): Promise<void> {
  const raw = parseArgs(process.argv.slice(2))
  const vaultPath = raw.vault
  const password = raw.password
  const email = raw.email
  const outputPath = raw.output ?? vaultPath

  if (!vaultPath || !password || !email) {
    printUsage()
    process.exitCode = 1
    return
  }

  console.log(`Loading vault: ${vaultPath}`)

  const vaultContent = await readFile(vaultPath, 'utf-8')

  const sdk = new Vultisig({
    storage: new MemoryStorage(),
    serverEndpoints: {
      fastVault: process.env.VULTISIG_API_URL || 'https://api.vultisig.com/vault',
      messageRelay: process.env.VULTISIG_ROUTER_URL || 'https://api.vultisig.com/router',
    },
    defaultChains: [],
    defaultCurrency: 'usd',
    onPasswordRequired: async () => password,
  })

  await sdk.initialize()
  console.log('Importing vault…')
  const vault = await sdk.importVault(vaultContent, password)

  if (!(vault instanceof FastVault)) {
    throw new Error('Only fast vaults support addPostQuantumKeys')
  }

  console.log('Adding ML-DSA keys (this may take a minute)…')
  await sdk.addPostQuantumKeysToFastVault(vault, {
    email,
    password,
    onProgress: u => {
      if (u.message) {
        console.log(`  ${u.message}`)
      }
    },
  })

  const updatedContent = vault.data.vultFileContent
  if (!updatedContent?.trim()) {
    throw new Error('Updated vault file content is empty; export failed')
  }

  await writeFile(outputPath, updatedContent, 'utf-8')
  console.log(`Wrote updated vault: ${outputPath}`)

  const mldsaPubKey = vault.publicKeyMldsa
  if (!mldsaPubKey) {
    throw new Error('ML-DSA public key missing after keygen')
  }

  const qbtcAddress = deriveQbtcAddress(mldsaPubKey)
  console.log('')
  console.log(`QBTC address (fund this for post-quantum chain): ${qbtcAddress}`)
}

const _argv1 = process.argv[1]
if (_argv1 && path.resolve(_argv1) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    let message = err instanceof Error ? err.message : String(err)
    if (err instanceof Error && err.cause !== undefined) {
      const c = err.cause instanceof Error ? err.cause.message : String(err.cause)
      message = `${message} (${c})`
    }
    console.error(`Error: ${message}`)
    process.exitCode = 1
  })
}
