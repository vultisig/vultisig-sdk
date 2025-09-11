#!/usr/bin/env node

/**
 * Debug what message hash the core system would generate
 * This mimics exactly what the extension does
 */

import { JsonRpcProvider, keccak256, getBytes, recoverAddress } from 'ethers'
import { serializeTransaction as viemSerialize } from 'viem'

const provider = new JsonRpcProvider('https://ethereum-rpc.publicnode.com')

// Our signature from the core system approach
const sig = '0xaba0be71e73b1716d7fc61accd60b1871a2cf07b936c5517b3b0a241e0e0b01463deba5481c07bcba06c3daa7b6e3fe4f2e900cc1f7e95d3cc0e1540e2d19615a0'

function parseAndNormalizeSig(sig) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new Error('Bad sig length/format')
  
  let r = '0x' + sig.slice(2, 66)
  let s = '0x' + sig.slice(66, 130)
  let v = parseInt(sig.slice(130, 132), 16)

  console.log('🔍 Raw signature components:')
  console.log('  r:', r)
  console.log('  s:', s)
  console.log('  v:', v, `(0x${v.toString(16)})`)

  // Normalize s to low-s (EIP-2)
  const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n
  const halfN = N >> 1n
  let yParity = v & 1
  let sBigInt = BigInt(s)
  
  console.log('  s > halfN:', sBigInt > halfN)
  
  if (sBigInt > halfN) {
    sBigInt = N - sBigInt
    s = '0x' + sBigInt.toString(16).padStart(64, '0')
    yParity ^= 1
    console.log('  ✅ Normalized s:', s)
    console.log('  ✅ New yParity:', yParity)
  } else {
    console.log('  ✅ s already normalized')
  }
  
  return { r, s, yParity, originalV: v }
}

async function testCoreSystemApproach() {
  console.log('🧪 Core System Message Hash Debug')
  console.log('=================================\n')
  
  const { r, s, yParity } = parseAndNormalizeSig(sig)
  
  // Try to replicate what the core system actually generates
  console.log('🔍 Testing different message hash approaches...\n')
  
  // The transaction parameters we're using
  const txParams = {
    to: '0x65261c9d3b49367e6a49902B1e735b2e734F8ee7',
    value: '100000000000000', // 0.0001 ETH
    gas: '21000',
    maxFeePerGas: '20000000000',
    maxPriorityFeePerGas: '2000000000',
    data: '0x',
    nonce: 0,
    chainId: 1,
    type: 2
  }
  
  console.log('📋 Transaction parameters:')
  console.log(JSON.stringify(txParams, null, 2))
  
  // Test approach 1: Standard EIP-1559 serialization
  console.log('\n🧪 Approach 1: Standard EIP-1559 serialization')
  try {
    const unsigned = viemSerialize({
      type: 'eip1559',
      chainId: txParams.chainId,
      nonce: txParams.nonce,
      to: txParams.to,
      value: BigInt(txParams.value),
      data: txParams.data,
      gas: BigInt(txParams.gas),
      maxFeePerGas: BigInt(txParams.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(txParams.maxPriorityFeePerGas),
      accessList: [],
    })
    
    console.log('  Unsigned RLP:', unsigned)
    const digest = keccak256(getBytes(unsigned))
    console.log('  Keccak256 hash:', digest)
    
    try {
      const recovered = recoverAddress(digest, { r, s, yParity })
      console.log('  ✅ Recovered address:', recovered)
      
      // Check if it matches the daemon address
      if (recovered.toLowerCase() === txParams.to.toLowerCase()) {
        console.log('  🎯 MATCH! Signature is for this transaction!')
      } else {
        console.log('  ❓ No match - recovered address is different')
      }
    } catch (error) {
      console.log('  ❌ Recovery failed:', error.message.split(' ')[0])
    }
    
  } catch (error) {
    console.log('  ❌ Serialization failed:', error.message)
  }
  
  // Test approach 2: Try to manually create what Trust Wallet Core might generate
  console.log('\n🧪 Approach 2: Manual Trust Wallet Core-style message')
  
  // This is a guess at what Trust Wallet Core might be doing internally
  const manualMessage = Buffer.concat([
    Buffer.from([0x02]), // EIP-1559 type
    Buffer.from([txParams.chainId]), // chainId
    Buffer.from([txParams.nonce]), // nonce
    Buffer.from(txParams.maxPriorityFeePerGas.toString(16).padStart(16, '0'), 'hex'), // maxPriorityFeePerGas
    Buffer.from(txParams.maxFeePerGas.toString(16).padStart(16, '0'), 'hex'), // maxFeePerGas
    Buffer.from(txParams.gas.toString(16).padStart(8, '0'), 'hex'), // gas
    Buffer.from(txParams.to.slice(2), 'hex'), // to address
    Buffer.from(txParams.value.toString(16).padStart(16, '0'), 'hex'), // value
    Buffer.from(txParams.data.slice(2), 'hex'), // data
    Buffer.from([]), // accessList (empty)
  ])
  
  const manualDigest = keccak256(manualMessage)
  console.log('  Manual digest:', manualDigest)
  
  try {
    const manualRecovered = recoverAddress(manualDigest, { r, s, yParity })
    console.log('  ✅ Manual recovered:', manualRecovered)
    
    if (manualRecovered.toLowerCase() === txParams.to.toLowerCase()) {
      console.log('  🎯 MANUAL MATCH! This might be the format!')
    }
  } catch (error) {
    console.log('  ❌ Manual recovery failed:', error.message.split(' ')[0])
  }
  
  // Test approach 3: Try with different addresses
  console.log('\n🧪 Approach 3: Testing with different potential addresses')
  
  const testAddresses = [
    '0x65261c9d3b49367e6a49902B1e735b2e734F8ee7', // daemon address
    '0x3B47C2D0678F92ECd8f54192D14d541f28DDbE97', // old target
    '0xF37328204822E1396e722483b0Ab9cB2dD1B6A62', // previous recovery
  ]
  
  const standardDigest = keccak256(getBytes(viemSerialize({
    type: 'eip1559',
    chainId: txParams.chainId,
    nonce: txParams.nonce,
    to: txParams.to,
    value: BigInt(txParams.value),
    data: txParams.data,
    gas: BigInt(txParams.gas),
    maxFeePerGas: BigInt(txParams.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(txParams.maxPriorityFeePerGas),
    accessList: [],
  })))
  
  try {
    const actualRecovered = recoverAddress(standardDigest, { r, s, yParity })
    console.log(`  Actual recovered address: ${actualRecovered}`)
    
    const match = testAddresses.find(addr => 
      addr.toLowerCase() === actualRecovered.toLowerCase()
    )
    
    if (match) {
      console.log(`  🎯 FOUND MATCH! The signature is for address: ${match}`)
    } else {
      console.log('  ❓ Signature is for a different address entirely')
      console.log(`  📍 The signature is actually for: ${actualRecovered}`)
    }
  } catch (error) {
    console.log('  ❌ Still failing recovery:', error.message)
  }
}

testCoreSystemApproach().catch(console.error)
