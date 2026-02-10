/**
 * E2E Real Swap Test
 *
 * Actually execute a small swap on FIN:
 * ETH → USDC using secured ETH balance
 */

import { MemoryStorage, Vultisig } from '@vultisig/sdk'
import * as fs from 'fs'

import { RujiraClient } from '../src'
import { VultisigRujiraProvider } from '../src/signer'

async function main() {
  const password = process.env.VAULT_PASSWORD
  const vultFilePath = process.env.VULT_FILE

  if (!password) throw new Error('Missing VAULT_PASSWORD env var')
  if (!vultFilePath) throw new Error('Missing VULT_FILE env var')

  console.log('🚀 Rujira Real Swap Test\n')

  // Setup
  const vultFileContent = fs.readFileSync(vultFilePath, 'utf8')
  const sdk = new Vultisig({
    storage: new MemoryStorage(),
    onPasswordRequired: async () => password,
  })
  await sdk.initialize()

  const vault = await sdk.importVault(vultFileContent, password)
  console.log(`✅ Vault: ${vault.name}`)

  const signer = new VultisigRujiraProvider(vault)
  const thorAddress = await signer.getAddress()
  console.log(`✅ THORChain: ${thorAddress}\n`)

  const client = new RujiraClient({
    network: 'mainnet',
    signer,
    apiKey: process.env.RUJIRA_API_KEY,
    debug: true,
  })

  await client.connect()

  // Check current balances
  console.log('📊 Current Balances:')
  const balances = await client.deposit.getBalances(thorAddress)
  for (const bal of balances) {
    console.log(`   ${bal.symbol}: ${bal.formatted}`)
  }

  const ethBalance = balances.find(b => b.symbol === 'ETH')
  if (!ethBalance || parseFloat(ethBalance.formatted) < 0.001) {
    console.log('\n❌ Insufficient secured ETH. Need at least 0.001 ETH.')
    return
  }

  console.log(`\n✅ Have ${ethBalance.formatted} secured ETH\n`)

  // Try the easy swap route
  console.log('💱 Executing ETH → USDC swap...')
  console.log('   Amount: 0.0001 ETH (10000 in 8 decimals)')

  try {
    const result = await client.swap.easySwap({
      route: 'ETH_TO_USDC',
      amount: '10000', // 0.0001 ETH in 8 decimals
      destination: thorAddress, // Receive USDC at same address
    })

    console.log('\n✅ SWAP SUCCESSFUL!')
    console.log(`   TX Hash: ${result.txHash}`)
    console.log(`   Status: ${result.status}`)

    // Check new balances
    console.log('\n📊 New Balances:')
    const newBalances = await client.deposit.getBalances(thorAddress)
    for (const bal of newBalances) {
      console.log(`   ${bal.symbol}: ${bal.formatted}`)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.log(`\n❌ Swap failed: ${msg}`)

    if (error instanceof Error && error.stack) {
      console.log('\nStack trace:')
      console.log(error.stack)
    }
  }
}

main().catch(e => {
  console.error('Fatal:', e)
  process.exit(1)
})
