#!/usr/bin/env node

/**
 * Test with real signature from VultiServer
 * Construct proper serialized transaction for broadcasting
 */

import { Transaction, Signature, JsonRpcProvider, getBytes, hexlify, keccak256, recoverAddress } from 'ethers'

async function testRealSignature() {
  console.log('🧪 Testing Real VultiServer Signature')
  console.log('====================================\n')

  // Real signature from VultiServer
  const realSignature = '0x9abe7e625e1d96daba5dc8f5a139f9bf92027c4ab08229849355d7da110dc2774577ca9f896ade5d79a9e402958c57bae2c677a274924775c63a83c2d22651e1b2'
  
  // Transaction data (USDC transfer to self)
  const txData = {
    to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC contract
    value: '0',
    data: '0xa9059cbb00000000000000000000000065261c9d3b49367e6a49902b1e735b2e734f8ee7000000000000000000000000000000000000000000000000000000000000f4240', // transfer(address,uint256)
    gasLimit: '100000',
    gasPrice: '20000000000', // 20 Gwei
    nonce: 0,
    type: 2,
    chainId: 1
  }

  console.log('📝 Real signature:', realSignature)
  console.log('📏 Signature length:', realSignature.length)
  console.log('📦 Transaction data:')
  console.log('  Contract:', txData.to)
  console.log('  Data:', txData.data.slice(0, 20) + '...')
  console.log('  Gas Limit:', txData.gasLimit)

  try {
    // Parse signature components (r, s, v)
    if (realSignature.length === 132) { // 0x + 130 hex chars
      const r = '0x' + realSignature.slice(2, 66)   // 32 bytes
      const s = '0x' + realSignature.slice(66, 130) // 32 bytes  
      const v = parseInt(realSignature.slice(130, 132), 16) // 1 byte
      
      console.log('\n🔍 Parsed signature components:')
      console.log('  r:', r)
      console.log('  s:', s)
      console.log('  v:', v)
      
      // Create unsigned transaction step by step with debugging
      console.log('\n🔧 Creating unsigned transaction...')
      const unsignedTx = new Transaction()
      
      console.log('  Setting to:', txData.to)
      unsignedTx.to = txData.to
      
      console.log('  Setting value: 0')
      unsignedTx.value = 0
      
      console.log('  Setting gasLimit:', BigInt(txData.gasLimit))
      unsignedTx.gasLimit = BigInt(txData.gasLimit)
      
      console.log('  Setting gasPrice:', BigInt(txData.gasPrice))
      unsignedTx.gasPrice = BigInt(txData.gasPrice)
      
      console.log('  Setting nonce:', txData.nonce)
      unsignedTx.nonce = txData.nonce
      
      console.log('  Setting type:', txData.type)
      unsignedTx.type = txData.type
      
      console.log('  Setting chainId:', txData.chainId)
      unsignedTx.chainId = txData.chainId
      
      console.log('  Setting data (length:', txData.data.length, ')...')
      try {
        unsignedTx.data = txData.data
        console.log('  ✅ Data set successfully')
      } catch (dataError) {
        console.error('  ❌ Failed to set data:', dataError.message)
        throw dataError
      }
      
      console.log('✅ Unsigned transaction created')
      
      // Create signature object
      console.log('\n🔧 Creating signature object...')
      const sigObj = Signature.from({ r, s, v })
      console.log('✅ Signature object created')
      
      // Clone transaction and add signature
      console.log('\n🔧 Adding signature to transaction...')
      const signedTx = unsignedTx.clone()
      signedTx.signature = sigObj
      console.log('✅ Signature added to transaction')
      
      // Get serialized transaction
      console.log('\n🔧 Serializing transaction...')
      const serialized = signedTx.serialized
      console.log('✅ Transaction serialized!')
      console.log('📝 Serialized transaction:', serialized.slice(0, 30) + '...')
      console.log('📏 Serialized length:', serialized.length)
      
      // Test broadcasting to mainnet
      console.log('\n🌐 Testing broadcast to Ethereum mainnet...')
      const provider = new JsonRpcProvider('https://eth.llamarpc.com')
      
      console.log('🚀 Broadcasting transaction...')
      const txResponse = await provider.broadcastTransaction(serialized)
      
      console.log('🎉 SUCCESS! Transaction broadcasted!')
      console.log('🔗 Transaction Hash:', txResponse.hash)
      console.log('⛽ Gas Limit:', txResponse.gasLimit.toString())
      console.log('💰 Gas Price:', txResponse.gasPrice.toString())
      
      // Wait for confirmation
      console.log('\n⏳ Waiting for confirmation...')
      const receipt = await txResponse.wait()
      
      console.log('✅ Transaction confirmed!')
      console.log('📦 Block Number:', receipt.blockNumber)
      console.log('⛽ Gas Used:', receipt.gasUsed.toString())
      console.log('💸 1 USDC transfer completed!')
      console.log(`🔍 View on Etherscan: https://etherscan.io/tx/${txResponse.hash}`)
      
    } else {
      throw new Error(`Invalid signature length: ${realSignature.length}`)
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    
    if (error.message.includes('rlp') || error.message.includes('parse')) {
      console.error('\n💡 RLP/Parsing issue - transaction format problem')
      console.error('   The signature is valid but transaction serialization needs work')
    } else if (error.message.includes('nonce')) {
      console.error('\n💡 Nonce issue - transaction nonce might be incorrect')
    } else if (error.message.includes('gas')) {
      console.error('\n💡 Gas issue - adjust gas limit or gas price')
    } else {
      console.error('\n💡 Unknown error - check transaction parameters')
    }
  }
}

testRealSignature().catch(console.error)
