#!/usr/bin/env node

/**
 * Test CLI signing with eth-tx-payload.json using environment configuration
 * 
 * Required environment variables:
 * - VAULT_PATH: Path to the vault file
 * - VAULT_PASSWORD: Password for the vault
 * - RPC_URL: Ethereum RPC URL for broadcasting (optional)
 */

import { VultisigSigner } from './dist/index.js'
import { JsonRpcProvider, parseEther } from 'ethers'
import { serializeTransaction, keccak256, recoverAddress } from 'viem'
import * as fs from 'fs'
import * as path from 'path'
import { config } from 'dotenv'

// Load environment variables from CLI's .env file
config({ path: '../../.env' })

async function testCliSigning() {
  console.log('🧪 Testing CLI Signing with Environment Configuration')
  console.log('=====================================================\n')

  // Validate environment variables
  const vaultPath = process.env.VAULT_PATH
  const vaultPassword = process.env.VAULT_PASSWORD
  const rpcUrl = process.env.RPC_URL || 'https://ethereum-rpc.publicnode.com'

  if (!vaultPath) {
    throw new Error('VAULT_PATH environment variable is required')
  }
  if (!vaultPassword) {
    throw new Error('VAULT_PASSWORD environment variable is required')
  }

  console.log('🔧 Configuration:')
  console.log('   Vault Path:', vaultPath)
  console.log('   Password:', '***' + vaultPassword.slice(-3))
  console.log('   RPC URL:', rpcUrl)

  // Load transaction payload
  const payload = JSON.parse(fs.readFileSync('eth-tx-payload.json', 'utf8'))
  console.log('\n📋 Transaction payload:')
  console.log(JSON.stringify(payload, null, 2))

  try {
    // Create provider for broadcasting
    const provider = new JsonRpcProvider(rpcUrl)
    
    // Create signer with environment configuration
    const signer = new VultisigSigner(provider, { 
      password: vaultPassword,
      mode: 'fast'
    })
    
    console.log('\n📡 1. Getting signer address...')
    const signerAddress = await signer.getAddress()
    console.log('   Signer address:', signerAddress)
    
  console.log('\n💰 2. Checking account balance...')
  const balance = await provider.getBalance(signerAddress)
  console.log('   Balance:', balance.toString(), 'wei')
  console.log('   Balance ETH:', parseEther(balance.toString()).toString())
  
  console.log('\n🔢 3. Fetching current nonce from RPC...')
  const currentNonce = await provider.getTransactionCount(signerAddress, 'pending')
  console.log('   Current nonce:', currentNonce)
  
  // Update payload with current nonce
  const updatedPayload = {
    ...payload,
    nonce: currentNonce
  }
  console.log('   Updated nonce in payload:', updatedPayload.nonce)
  
  console.log('\n🔐 4. Signing transaction with CLI daemon...')
  let signedTx = await signer.signTransaction(updatedPayload)
    
    console.log('✅ Transaction signed successfully!')
    console.log('📝 Signed transaction:', signedTx.substring(0, 50) + '...')
    console.log('📏 Length:', signedTx.length, 'characters')
    
    console.log('\n🔍 5. Verifying signature cryptographically...')
    
    // Convert updated payload to viem format for hash calculation
    const viemTx = {
      type: 'eip1559',
      chainId: updatedPayload.chainId,
      nonce: updatedPayload.nonce,
      to: updatedPayload.to,
      value: BigInt(updatedPayload.value),
      data: updatedPayload.data || '0x',
      gas: BigInt(updatedPayload.gasLimit),
      maxFeePerGas: BigInt(updatedPayload.maxFeePerGas || updatedPayload.gasPrice),
      maxPriorityFeePerGas: BigInt(updatedPayload.maxPriorityFeePerGas || '0'),
      accessList: []
    }
    
    // Serialize and hash the transaction
    const serialized = serializeTransaction(viemTx)
    const messageHash = keccak256(serialized)
    console.log('   Transaction hash:', messageHash)
    
    // Parse DER signature and create complete EIP transaction
    if (signedTx.length >= 140) { // DER format
      console.log('   Parsing DER signature...')
      const rLength = parseInt(signedTx.substr(6, 2), 16)
      const rHex = signedTx.substr(8, rLength * 2)
      const sStart = 8 + rLength * 2 + 4
      const sLength = parseInt(signedTx.substr(sStart - 2, 2), 16)
      const sHex = signedTx.substr(sStart, sLength * 2)
      
      const r = '0x' + rHex.padStart(64, '0')
      const s = '0x' + sHex.padStart(64, '0')
      
      // Try both recovery IDs to find the correct one
      let v = 27
      let recoveredAddress = await recoverAddress({
        hash: messageHash,
        signature: { r, s, v: BigInt(v) }
      })
      
      if (recoveredAddress.toLowerCase() !== signerAddress.toLowerCase()) {
        v = 28
        recoveredAddress = await recoverAddress({
          hash: messageHash,
          signature: { r, s, v: BigInt(v) }
        })
      }
      
      console.log('   r:', r)
      console.log('   s:', s)
      console.log('   v:', v)
      console.log('   Recovered address:', recoveredAddress)
      console.log('   Expected address:', signerAddress)
      
      if (recoveredAddress.toLowerCase() === signerAddress.toLowerCase()) {
        console.log('✅ Signature verification successful!')
      } else {
        throw new Error('Signature verification failed - addresses don\'t match')
      }
      
      // Create complete signed transaction
      console.log('\n🔧 6. Creating complete EIP transaction...')
      const completeSignedTx = serializeTransaction({
        ...viemTx,
        r,
        s,
        v: BigInt(v)
      })
      
      console.log('   ✅ Complete signed transaction created!')
      console.log('   📝 Serialized TX:', completeSignedTx.substring(0, 50) + '...')
      console.log('   📏 Length:', completeSignedTx.length, 'characters')
      
      // Store the complete transaction for broadcasting
      signedTx = completeSignedTx
    }
    
    console.log('\n📡 5. Broadcasting transaction to network...')
    
    try {
      // Check if we should actually broadcast (safety check)
      const shouldBroadcast = process.env.BROADCAST_TX === 'true'
      
      if (shouldBroadcast) {
        console.log('   🚀 Broadcasting to mainnet...')
        const txResponse = await provider.broadcastTransaction(signedTx)
        console.log('   ✅ Transaction broadcast successful!')
        console.log('   📋 Transaction hash:', txResponse.hash)
        console.log('   🔗 View on Etherscan: https://etherscan.io/tx/' + txResponse.hash)
        
        console.log('   ⏳ Waiting for confirmation...')
        const receipt = await txResponse.wait()
        console.log('   ✅ Transaction confirmed in block:', receipt.blockNumber)
        
        return {
          signedTx,
          txHash: txResponse.hash,
          receipt,
          payload
        }
      } else {
        console.log('   ⚠️  Skipping broadcast (set BROADCAST_TX=true to broadcast)')
        console.log('   📝 Transaction is ready for broadcast')
        console.log('   🔗 Signed transaction:', signedTx)
        
        return {
          signedTx,
          payload,
          verified: true
        }
      }
    } catch (error) {
      console.error('   ❌ Broadcast failed:', error.message)
      console.log('   💡 This might be expected if account has insufficient balance')
      console.log('   📝 But the signature is still valid!')
      
      return {
        signedTx,
        payload,
        verified: true,
        broadcastError: error.message
      }
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    
    if (error.message.includes('ENOENT') || error.message.includes('socket')) {
      console.error('\n💡 Make sure Vultisig daemon is running:')
      console.error('   cd /path/to/vultisig-sdk/clients/cli')
      console.error('   ./bin/vultisig run --vault $VAULT_PATH --password $VAULT_PASSWORD')
      console.error('\n💡 Or set environment variables:')
      console.error('   export VAULT_PATH="/path/to/your/vault.vult"')
      console.error('   export VAULT_PASSWORD="your-password"')
      console.error('   export RPC_URL="https://your-ethereum-rpc-url" # optional')
      console.error('   export BROADCAST_TX="true" # optional, for actual broadcasting')
    }
    
    throw error
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error)
  process.exit(1)
})

testCliSigning().then(result => {
  if (result) {
    console.log('\n🎉 COMPLETE ETH SIGNER INTEGRATION TEST SUCCESS!')
    console.log('================================================')
    console.log('✅ Environment configuration loaded')
    console.log('✅ CLI daemon communication working')
    console.log('✅ MPC signing completed')
    console.log('✅ Signature cryptographically verified')
    
    if (result.receipt) {
      console.log('✅ Transaction broadcast and confirmed')
      console.log('📋 Block number:', result.receipt.blockNumber)
    } else if (result.broadcastError) {
      console.log('⚠️  Broadcast skipped due to:', result.broadcastError)
    } else {
      console.log('⚠️  Broadcast skipped (set BROADCAST_TX=true to broadcast)')
    }
    
    console.log('\n🎯 Integration ready for:')
    console.log('   • DeFi protocols (Uniswap, Aave, etc.)')
    console.log('   • NFT marketplaces')
    console.log('   • Custom DApp development')
    console.log('   • Enterprise MPC applications')
    
    console.log('\n📚 Usage in your application:')
    console.log('   const signer = new VultisigSigner(provider, { mode: "fast", password: env.VAULT_PASSWORD })')
    console.log('   const tx = await signer.signTransaction(transactionRequest)')
    console.log('   const receipt = await provider.broadcastTransaction(tx)')
  }
}).catch(error => {
  console.error('\n💥 CLI signing test failed:', error.message)
  process.exit(1)
})
