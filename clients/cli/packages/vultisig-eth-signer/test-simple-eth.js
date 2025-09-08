#!/usr/bin/env node

/**
 * Test with simple ETH transfer to avoid data field issues
 */

import { Transaction, Signature, JsonRpcProvider } from 'ethers'

async function testSimpleEthTransfer() {
  console.log('🧪 Testing Simple ETH Transfer')
  console.log('==============================\n')

  // Real signature from VultiServer
  const realSignature = '0x9abe7e625e1d96daba5dc8f5a139f9bf92027c4ab08229849355d7da110dc2774577ca9f896ade5d79a9e402958c57bae2c677a274924775c63a83c2d22651e1b2'
  
  // Get current nonce from network first
  console.log('🌐 Connecting to Ethereum mainnet...')
      const provider = new JsonRpcProvider('https://ethereum-rpc.publicnode.com')
  const address = '0x65261c9d3b49367e6a49902B1e735b2e734F8ee7'
  
  console.log('📍 Getting current nonce for:', address)
  const currentNonce = await provider.getTransactionCount(address, 'pending')
  console.log('📊 Current nonce:', currentNonce)
  
  // Simple ETH transfer (no data field to avoid the bug)
  const txData = {
    to: address, // Send to self
    value: '100000000000000000', // 0.1 ETH (smaller amount)
    gasLimit: '21000',
    gasPrice: '30000000000', // 30 Gwei (higher gas price)
    nonce: currentNonce,
    type: 2,
    chainId: 1
  }

  console.log('📝 Real signature:', realSignature)
  console.log('📦 Simple ETH transfer:')
  console.log('  To:', txData.to)
  console.log('  Value: 1 ETH')
  console.log('  Gas Limit:', txData.gasLimit)

  try {
    // Parse signature components
    const r = '0x' + realSignature.slice(2, 66)
    const s = '0x' + realSignature.slice(66, 130)
    const v = parseInt(realSignature.slice(130, 132), 16)
    
    console.log('\n🔍 Signature components:')
    console.log('  r:', r)
    console.log('  s:', s)
    console.log('  v:', v)
    
    // Create transaction (no data field)
    console.log('\n🔧 Creating simple ETH transaction...')
    const tx = new Transaction()
    tx.to = txData.to
    tx.value = BigInt(txData.value)
    tx.gasLimit = BigInt(txData.gasLimit)
    tx.gasPrice = BigInt(txData.gasPrice)
    tx.nonce = txData.nonce
    tx.type = txData.type
    tx.chainId = txData.chainId
    // NO DATA FIELD - this should work
    
    console.log('✅ Simple transaction created')
    
    // Add signature
    const sigObj = Signature.from({ r, s, v })
    tx.signature = sigObj
    console.log('✅ Signature added')
    
    // Serialize
    const serialized = tx.serialized
    console.log('✅ Transaction serialized!')
    console.log('📝 Serialized:', serialized.slice(0, 30) + '...')
    console.log('📏 Length:', serialized.length)
    
      // Test broadcast
    
    console.log('🚀 Broadcasting simple ETH transfer...')
    const txResponse = await provider.broadcastTransaction(serialized)
    
    console.log('🎉 SUCCESS! Transaction broadcasted!')
    console.log('🔗 Transaction Hash:', txResponse.hash)
    
    // Wait for confirmation
    console.log('\n⏳ Waiting for confirmation...')
    const receipt = await txResponse.wait()
    
    console.log('✅ Transaction confirmed!')
    console.log('📦 Block Number:', receipt.blockNumber)
    console.log('💸 1 ETH transfer completed!')
    console.log(`🔍 View on Etherscan: https://etherscan.io/tx/${txResponse.hash}`)
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    
    if (error.message.includes('rlp')) {
      console.error('💡 RLP encoding issue')
    } else if (error.message.includes('nonce')) {
      console.error('💡 Nonce issue - need to get current nonce from network')
    } else if (error.message.includes('insufficient funds')) {
      console.error('💡 Insufficient ETH for transfer + gas')
    } else {
      console.error('💡 Other issue:', error.code)
    }
  }
}

testSimpleEthTransfer().catch(console.error)
