#!/usr/bin/env node

/**
 * Debug signature format and conversion
 */

import { Transaction, Signature, JsonRpcProvider } from 'ethers'

async function debugSignature() {
  console.log('🔍 Debug Signature Format')
  console.log('========================\n')

  // Real signature from VultiServer (65 bytes: r||s||v)
  const realSignature = '0x9abe7e625e1d96daba5dc8f5a139f9bf92027c4ab08229849355d7da110dc2774577ca9f896ade5d79a9e402958c57bae2c677a274924775c63a83c2d22651e1b2'
  
  // Parse signature components
  const r = '0x' + realSignature.slice(2, 66)   // 32 bytes
  const s = '0x' + realSignature.slice(66, 130) // 32 bytes  
  const v = parseInt(realSignature.slice(130, 132), 16) // 1 byte
  
  console.log('📝 Original signature:', realSignature)
  console.log('📏 Length:', realSignature.length, 'characters')
  console.log('\n🔍 Parsed components:')
  console.log('  r:', r)
  console.log('  s:', s)
  console.log('  v:', v)
  console.log('  v (binary):', v.toString(2).padStart(8, '0'))
  
  // Calculate yParity for EIP-1559
  const yParity = v & 1
  console.log('\n🔄 EIP-1559 conversion:')
  console.log('  yParity (v & 1):', yParity)
  
  // Check if signature needs normalization (low-s rule EIP-2)
  const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n
  const halfN = N >> 1n
  const sBigInt = BigInt(s)
  
  console.log('\n🔍 Low-s rule check (EIP-2):')
  console.log('  s:', sBigInt.toString(16))
  console.log('  halfN:', halfN.toString(16))
  console.log('  s > halfN:', sBigInt > halfN)
  
  let normalizedS = s
  let normalizedYParity = yParity
  
  if (sBigInt > halfN) {
    normalizedS = '0x' + (N - sBigInt).toString(16).padStart(64, '0')
    normalizedYParity = yParity ^ 1
    console.log('  ⚠️  Signature needs normalization!')
    console.log('  normalized s:', normalizedS)
    console.log('  normalized yParity:', normalizedYParity)
  } else {
    console.log('  ✅ Signature is already normalized')
  }
  
  // Try different signature formats
  console.log('\n🧪 Testing different signature formats:')
  
  const txData = {
    type: 2, // EIP-1559
    chainId: 1,
    nonce: 121,
    to: '0x65261c9d3b49367e6a49902B1e735b2e734F8ee7',
    value: '1000000000000000000', // 1 ETH
    gasLimit: 21000,
    maxFeePerGas: '20000000000', // 20 Gwei
    maxPriorityFeePerGas: '2000000000', // 2 Gwei
    data: '0x'
  }
  
  console.log('📦 Transaction data:', txData)
  
  // Test 1: Original v value
  console.log('\n🧪 Test 1: Original v value')
  try {
    const tx1 = new Transaction()
    Object.assign(tx1, txData)
    const sig1 = Signature.from({ r, s, v })
    tx1.signature = sig1
    const serialized1 = tx1.serialized
    console.log('  ✅ Serialized with original v:', serialized1.slice(0, 30) + '...')
    console.log('  📏 Length:', serialized1.length)
  } catch (error) {
    console.log('  ❌ Failed:', error.message)
  }
  
  // Test 2: yParity conversion
  console.log('\n🧪 Test 2: yParity conversion')
  try {
    const tx2 = new Transaction()
    Object.assign(tx2, txData)
    const sig2 = Signature.from({ r, s, yParity })
    tx2.signature = sig2
    const serialized2 = tx2.serialized
    console.log('  ✅ Serialized with yParity:', serialized2.slice(0, 30) + '...')
    console.log('  📏 Length:', serialized2.length)
  } catch (error) {
    console.log('  ❌ Failed:', error.message)
  }
  
  // Test 3: Normalized signature
  console.log('\n🧪 Test 3: Normalized signature')
  try {
    const tx3 = new Transaction()
    Object.assign(tx3, txData)
    const sig3 = Signature.from({ r, s: normalizedS, yParity: normalizedYParity })
    tx3.signature = sig3
    const serialized3 = tx3.serialized
    console.log('  ✅ Serialized with normalized sig:', serialized3.slice(0, 30) + '...')
    console.log('  📏 Length:', serialized3.length)
  } catch (error) {
    console.log('  ❌ Failed:', error.message)
  }
}

debugSignature().catch(console.error)
