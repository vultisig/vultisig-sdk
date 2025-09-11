#!/usr/bin/env node

/**
 * Test what the proper Ethereum transaction hash should be
 * This mimics what Trust Wallet Core would generate
 */

import { JsonRpcProvider, keccak256, getBytes, recoverAddress, toBeHex } from 'ethers'
import { serializeTransaction as viemSerialize, parseTransaction } from 'viem'

const provider = new JsonRpcProvider('https://ethereum-rpc.publicnode.com')

// Our signature from VultiSig CLI
const sig = '0xee4f870f1bd03267b24d3e6c2b8bb524dea63dc4aa99afbc90277ec429a70e13f147d11dc8c42ecc863f8dad919452aa2075dc13ee6166cb4fe6c6f7b10c84e4e3'

// Transaction parameters that were signed
const txParams = {
  to: '0x3B47C2D0678F92ECd8f54192D14d541f28DDbE97',
  value: '100000000000000', // 0.0001 ETH in wei as string
  gas: '21000',
  maxFeePerGas: '20000000000',
  maxPriorityFeePerGas: '2000000000',
  data: '0x',
  nonce: 0,
  chainId: 1,
  type: 2
}

function normalizeSig(sig) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new Error('Bad sig length/format')
  
  let r = '0x' + sig.slice(2, 66)
  let s = '0x' + sig.slice(66, 130)
  let v = parseInt(sig.slice(130, 132), 16)

  // Normalize s to low-s (EIP-2)
  const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n
  const halfN = N >> 1n
  let yParity = v & 1
  let sBigInt = BigInt(s)
  
  if (sBigInt > halfN) {
    sBigInt = N - sBigInt
    s = '0x' + sBigInt.toString(16).padStart(64, '0')
    yParity ^= 1
  }
  
  return { r, s, yParity, originalV: v }
}

async function testTrustWalletCoreApproach() {
  console.log('🔍 Testing Trust Wallet Core Approach')
  console.log('====================================\n')
  
  const { r, s, yParity } = normalizeSig(sig)
  
  // Test different approaches to see what Trust Wallet Core might be doing
  
  console.log('📋 Transaction parameters from CLI:')
  console.log(JSON.stringify(txParams, null, 2))
  
  // Approach 1: Standard EIP-1559 serialization
  console.log('\n🧪 Approach 1: Standard EIP-1559 RLP serialization')
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
    console.log('  Length:', unsigned.length)
    
    const digest = keccak256(getBytes(unsigned))
    console.log('  Keccak256 hash:', digest)
    
    const from = recoverAddress(digest, { r, s, yParity })
    console.log('  Recovered address:', from)
    console.log('  Matches expected:', from.toLowerCase() === txParams.to.toLowerCase() ? '✅' : '❌')
    
  } catch (error) {
    console.log('  ❌ Failed:', error.message)
  }
  
  // Approach 2: Trust Wallet Core might use different field ordering or encoding
  console.log('\n🧪 Approach 2: Different field ordering')
  try {
    // Try with different field order - Trust Wallet Core might serialize differently
    const reorderedTx = {
      chainId: txParams.chainId,
      nonce: txParams.nonce,
      maxPriorityFeePerGas: BigInt(txParams.maxPriorityFeePerGas),
      maxFeePerGas: BigInt(txParams.maxFeePerGas),
      gas: BigInt(txParams.gas),
      to: txParams.to,
      value: BigInt(txParams.value),
      data: txParams.data,
      accessList: [],
      type: 'eip1559',
    }
    
    const unsigned2 = viemSerialize(reorderedTx)
    const digest2 = keccak256(getBytes(unsigned2))
    console.log('  Keccak256 hash:', digest2)
    
    const from2 = recoverAddress(digest2, { r, s, yParity })
    console.log('  Recovered address:', from2)
    console.log('  Matches expected:', from2.toLowerCase() === txParams.to.toLowerCase() ? '✅' : '❌')
    
  } catch (error) {
    console.log('  ❌ Failed:', error.message)
  }
  
  // Approach 3: Maybe Trust Wallet Core is still using legacy format internally
  console.log('\n🧪 Approach 3: Trust Wallet Core using legacy format internally')
  try {
    const legacyTx = {
      type: 'legacy',
      chainId: txParams.chainId,
      nonce: txParams.nonce,
      to: txParams.to,
      value: BigInt(txParams.value),
      data: txParams.data,
      gas: BigInt(txParams.gas),
      gasPrice: BigInt(txParams.maxFeePerGas), // Use maxFeePerGas as gasPrice
    }
    
    const unsigned3 = viemSerialize(legacyTx)
    const digest3 = keccak256(getBytes(unsigned3))
    console.log('  Keccak256 hash:', digest3)
    
    const from3 = recoverAddress(digest3, { r, s, v: sig.slice(130, 132) })
    console.log('  Recovered address (with original v):', from3)
    console.log('  Matches expected:', from3.toLowerCase() === txParams.to.toLowerCase() ? '✅' : '❌')
    
  } catch (error) {
    console.log('  ❌ Failed:', error.message)
  }
  
  // Approach 4: What if CLI is using a completely different chain ID?
  console.log('\n🧪 Approach 4: Different chain IDs')
  const testChainIds = [1, 96, 137, 56, 43114] // Ethereum, BSC testnet, Polygon, BSC, Avalanche
  
  for (const testChainId of testChainIds) {
    try {
      const testTx = {
        type: 'eip1559',
        chainId: testChainId,
        nonce: txParams.nonce,
        to: txParams.to,
        value: BigInt(txParams.value),
        data: txParams.data,
        gas: BigInt(txParams.gas),
        maxFeePerGas: BigInt(txParams.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(txParams.maxPriorityFeePerGas),
        accessList: [],
      }
      
      const unsigned = viemSerialize(testTx)
      const digest = keccak256(getBytes(unsigned))
      
      const from = recoverAddress(digest, { r, s, yParity })
      console.log(`  ChainId ${testChainId}: ${from} ${from.toLowerCase() === txParams.to.toLowerCase() ? '✅' : '❌'}`)
      
    } catch (error) {
      console.log(`  ChainId ${testChainId}: ❌ ${error.message.split(' ')[0]}`)
    }
  }
  
  console.log('\n🎯 Expected address:', txParams.to)
  console.log('🔍 The issue is that the CLI is using Trust Wallet Core\'s proper transaction')
  console.log('   signing, but we\'re trying to verify with a different approach.')
  console.log('   We need to use the exact same transaction serialization method.')
}

testTrustWalletCoreApproach().catch(console.error)
