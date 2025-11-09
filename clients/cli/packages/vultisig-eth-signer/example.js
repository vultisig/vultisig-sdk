#!/usr/bin/env node

/**
 * Vultisig Ethereum Signer Example
 * Demonstrates fast signing with VultiServer
 */

import { VultisigSigner } from './dist/index.js'
import { JsonRpcProvider, parseEther, formatEther } from 'ethers'
import * as fs from 'fs'
import * as path from 'path'

// Load environment variables from current directory or parent directories
function loadEnv() {
  const possiblePaths = [
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '..', '.env'),
    path.join(process.cwd(), '..', '..', '.env'),
    path.join(process.cwd(), '..', '..', '..', '..', '.env'),
  ]

  for (const envPath of possiblePaths) {
    try {
      const envContent = fs.readFileSync(envPath, 'utf8')
      const lines = envContent.split('\n')

      for (const line of lines) {
        const trimmedLine = line.trim()
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const [key, ...valueParts] = trimmedLine.split('=')
          if (key && valueParts.length > 0) {
            process.env[key.trim()] = valueParts.join('=').trim()
          }
        }
      }
      console.log(`📄 Loaded .env file from ${envPath}`)
      return
    } catch (error) {
      // Continue to next path
    }
  }
  console.log('No .env file found, using environment variables')
}

async function main() {
  console.log('🚀 Vultisig Ethereum Signer Example')
  console.log('=====================================\n')

  // Load environment variables
  loadEnv()

  const password = process.env.PASSWORD
  if (!password) {
    console.error('❌ PASSWORD environment variable required')
    console.error('   Set PASSWORD=your-vault-password in .env file')
    process.exit(1)
  }

  try {
    // Create provider (using a reliable public RPC)
    console.log('🌐 Connecting to Ethereum mainnet...')
    const provider = new JsonRpcProvider('https://ethereum-rpc.publicnode.com')

    // Create signer (defaults to fast mode)
    console.log('🔐 Creating Vultisig signer...')
    const signer = new VultisigSigner(provider, { password })

    console.log('📋 Signer configuration:')
    console.log('  Mode:', signer.getSigningMode())
    console.log('  Socket:', '/tmp/vultisig.sock')

    // Get address
    console.log('\n📍 Getting wallet address...')
    const address = await signer.getAddress()
    console.log('✅ Address:', address)

    // Get balance
    console.log('\n💰 Getting ETH balance...')
    const balance = await provider.getBalance(address)
    console.log('✅ Balance:', formatEther(balance), 'ETH')

    // Get current nonce to ensure transaction parameters match what will be signed
    console.log('\n📊 Getting current nonce from network...')
    const currentNonce = await provider.getTransactionCount(address, 'pending')
    console.log('✅ Current nonce:', currentNonce)

    // Create USDC transfer transaction (1 USDC back to self)
    console.log('\n💸 Creating USDC transfer transaction...')

    // USDC contract address on Ethereum mainnet
    const usdcContractAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

    // USDC transfer function signature: transfer(address,uint256)
    const transferFunctionSignature = '0xa9059cbb'

    // Encode transfer to self (1 USDC = 1000000 units, USDC has 6 decimals)
    const recipientAddress = address.slice(2).padStart(64, '0') // Remove 0x and pad
    const amount = '1000000' // 1 USDC in smallest units
    const amountHex = parseInt(amount).toString(16).padStart(64, '0')

    const transactionData =
      transferFunctionSignature + recipientAddress + amountHex

    const transaction = {
      to: usdcContractAddress,
      value: '0', // No ETH value for ERC20 transfer
      data: transactionData,
      gasLimit: '100000', // Higher gas limit for ERC20 transfer
      gasPrice: '20000000000', // 20 Gwei
      nonce: currentNonce, // Use current nonce from network
      type: 2, // EIP-1559
      chainId: 1, // Mainnet
    }

    console.log('📋 USDC Transaction details:')
    console.log('  Contract:', usdcContractAddress)
    console.log('  To:', address)
    console.log('  Amount: 1 USDC')
    console.log('  Gas Limit:', transaction.gasLimit)
    console.log('  Gas Price:', transaction.gasPrice, 'wei')
    console.log('  Data:', transactionData.slice(0, 20) + '...')

    // Check if daemon is running first
    console.log('\n🔍 Checking if Vultisig daemon is running...')
    try {
      await signer.getAddress()
      console.log('✅ Daemon is running and vault is loaded')
    } catch (error) {
      console.error('❌ Daemon not running or vault not loaded')
      console.error('\n💡 Please start the daemon first:')
      console.error(
        '   vultisig run --vault /path/to/your/vault.vult --password $PASSWORD'
      )
      process.exit(1)
    }

    // Sign the transaction
    console.log('\n✍️ Signing USDC transaction with fast mode...')
    const signedTx = await signer.signTransaction(transaction)

    console.log('✅ Transaction signed successfully!')
    console.log('📝 Signed transaction:', signedTx.slice(0, 20) + '...')
    console.log('📏 Length:', signedTx.length, 'characters')

    // Broadcast the transaction
    console.log('\n🚀 Broadcasting USDC transaction...')
    const txResponse = await provider.broadcastTransaction(signedTx)
    console.log('✅ Transaction broadcasted!')
    console.log('🔗 Transaction Hash:', txResponse.hash)
    console.log('⛽ Gas Limit:', txResponse.gasLimit.toString())
    console.log('💰 Gas Price:', txResponse.gasPrice.toString(), 'wei')

    // Wait for confirmation
    console.log('\n⏳ Waiting for confirmation...')
    const receipt = await txResponse.wait()
    console.log('✅ Transaction confirmed!')
    console.log('📦 Block Number:', receipt.blockNumber)
    console.log('⛽ Gas Used:', receipt.gasUsed.toString())
    console.log('💸 1 USDC sent to self successfully!')

    console.log('\n🎉 USDC transfer completed successfully!')
    console.log(
      `🔍 View on Etherscan: https://etherscan.io/tx/${txResponse.hash}`
    )
  } catch (error) {
    console.error('\n❌ Error:', error.message)

    if (error.message.includes('ENOENT') || error.message.includes('socket')) {
      console.error('\n💡 Make sure Vultisig daemon is running:')
      console.error(
        '   vultisig run --vault /path/to/your/vault.vult --password $PASSWORD'
      )
    } else if (error.message.includes('password')) {
      console.error('\n💡 Check your vault password in .env file')
    }

    process.exit(1)
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error)
  process.exit(1)
})

main().catch(console.error)
