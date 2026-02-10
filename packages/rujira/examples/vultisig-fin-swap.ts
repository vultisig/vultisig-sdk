/**
 * Example: Execute a FIN swap using VultisigRujiraProvider
 *
 * This demonstrates the signer bridge used by the Rujira SDK:
 *   RujiraClient -> (CosmJS Signer interface) -> VultisigRujiraProvider -> Vultisig vault (Fast or Secure)
 *
 * Requirements:
 * - A Vultisig vault exported as a .vult file (Fast vault) OR available via your Secure vault flow.
 * - RUJIRA_API_KEY (recommended) to avoid GraphQL rate limits.
 *
 * Notes:
 * - For Secure vaults, you typically obtain a `Vault` instance via the Vultisig SDK login/connect flow
 *   rather than importing a .vult file. The provider works with both as long as you pass a vault object
 *   that satisfies the Vultisig SDK vault interface.
 */

import { MemoryStorage, Vultisig } from '@vultisig/sdk'
import * as fs from 'fs'

import { EASY_ROUTES, RujiraClient } from '../src'
import { VultisigRujiraProvider } from '../src/signer'

async function main() {
  const password = process.env.VAULT_PASSWORD
  const vultFilePath = process.env.VULT_FILE

  if (!password) throw new Error('Missing VAULT_PASSWORD env var')
  if (!vultFilePath) throw new Error('Missing VULT_FILE env var (path to exported .vult file)')

  const vultFileContent = fs.readFileSync(vultFilePath, 'utf8')

  // Initialize Vultisig SDK and import the vault (Fast vault flow)
  const sdk = new Vultisig({
    storage: new MemoryStorage(),
    onPasswordRequired: async () => password,
  })
  await sdk.initialize()

  const vault = await sdk.importVault(vultFileContent, password)

  // Bridge the vault into a CosmJS-compatible signer
  const signer = new VultisigRujiraProvider(vault)
  const address = await signer.getAddress()

  const client = new RujiraClient({
    network: 'mainnet',
    signer,
    apiKey: process.env.RUJIRA_API_KEY,
  })

  await client.connect()

  // Perform a simple swap (example: RUNE -> USDC)
  const route = EASY_ROUTES.RUNE_TO_USDC

  const result = await client.swap.easySwap({
    route: 'RUNE_TO_USDC',
    amount: '10000000', // 0.1 RUNE (8 decimals)
    // memo: 'optional memo',
  })

  console.log(
    JSON.stringify(
      {
        from: route.from,
        to: route.to,
        address,
        txHash: result.txHash,
      },
      null,
      2
    )
  )
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
