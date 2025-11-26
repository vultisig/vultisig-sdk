/**
 * Quick script to check ETH balance of test vault
 * Run with: node test-eth-balance.js
 */

import { readFile } from 'fs/promises'

import { Vultisig } from './dist/index.js'

async function checkBalance() {
  console.log('🔍 Checking ETH balance...\n')

  // Check environment variables
  const vaultPath = process.env.TEST_VAULT_PATH
  const vaultPassword = process.env.TEST_VAULT_PASSWORD

  if (!vaultPath || !vaultPassword) {
    console.error('❌ ERROR: Environment variables not set!')
    console.error('   Set TEST_VAULT_PATH and TEST_VAULT_PASSWORD first.\n')
    process.exit(1)
  }

  console.log(`📁 Vault: ${vaultPath}`)

  try {
    // Initialize SDK
    const sdk = new Vultisig({ autoInit: true })
    await sdk.initialize()
    console.log('✅ SDK initialized\n')

    // Load vault
    const vaultBuffer = await readFile(vaultPath)
    const vaultFile = new File([vaultBuffer], 'vault.vult', {
      type: 'application/octet-stream',
    })
    const vault = await sdk.addVault(vaultFile, vaultPassword)
    console.log('✅ Vault loaded\n')

    // Get Ethereum address
    const ethAddress = await vault.address('Ethereum')
    console.log(`📍 Ethereum Address: ${ethAddress}`)

    // Fetch balance
    console.log('⏳ Fetching balance from blockchain...')
    const balance = await vault.balance('Ethereum')

    console.log('\n📊 Balance Information:')
    console.log(`   Amount: ${balance.amount} wei`)
    console.log(`   Decimals: ${balance.decimals}`)
    console.log(`   Symbol: ${balance.symbol}`)

    // Convert to ETH
    const ethAmount = Number(balance.amount) / Math.pow(10, balance.decimals)
    console.log(`   Human-readable: ${ethAmount} ETH`)

    // Check if sufficient for test
    const testAmount = 700000000000000 // 0.0007 ETH
    const hasEnough = BigInt(balance.amount) >= BigInt(testAmount)

    console.log('\n🧪 Test Requirements:')
    console.log(`   Test needs: 0.0007 ETH (~$2)`)
    console.log(`   You have: ${ethAmount} ETH`)
    console.log(`   Sufficient: ${hasEnough ? '✅ YES' : '❌ NO'}`)

    if (!hasEnough) {
      console.log('\n⚠️  WARNING: Insufficient balance for test!')
      console.log('   Please send at least 0.001 ETH to the address above (~$3 + gas)')
    } else {
      console.log('\n✅ Ready to run transaction preparation tests!')
    }
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    if (error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

checkBalance()
