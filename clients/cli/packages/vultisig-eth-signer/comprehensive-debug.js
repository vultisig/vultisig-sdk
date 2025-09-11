#!/usr/bin/env node

/**
 * Comprehensive debug of signature mismatch
 */

import { JsonRpcProvider, keccak256, getBytes, recoverAddress, toBeHex, Transaction } from 'ethers'
import { serializeTransaction as viemSerialize } from 'viem'

const provider = new JsonRpcProvider('https://ethereum-rpc.publicnode.com')

// Our signature from VultiSig CLI
const sig = '0xee4f870f1bd03267b24d3e6c2b8bb524dea63dc4aa99afbc90277ec429a70e13f147d11dc8c42ecc863f8dad919452aa2075dc13ee6166cb4fe6c6f7b10c84e4e3'

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

async function testAllPossibleTransactions() {
  console.log('🔍 Comprehensive Transaction Format Test')
  console.log('======================================\n')
  
  const { r, s, yParity, originalV } = normalizeSig(sig)
  console.log('Normalized signature:')
  console.log('  r:', r)
  console.log('  s:', s)
  console.log('  yParity:', yParity)
  console.log('  originalV:', originalV)
  
  const baseParams = {
    to: '0x3B47C2D0678F92ECd8f54192D14d541f28DDbE97',
    value: 100000000000000n, // 0.0001 ETH
    data: '0x',
    nonce: 0,
    gas: 21000n,
  }
  
  const testCases = [
    // EIP-1559 variations
    {
      name: 'EIP-1559 chainId:1',
      tx: { type: 'eip1559', chainId: 1, ...baseParams, maxFeePerGas: 20_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n, accessList: [] }
    },
    {
      name: 'EIP-1559 chainId:96',
      tx: { type: 'eip1559', chainId: 96, ...baseParams, maxFeePerGas: 20_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n, accessList: [] }
    },
    
    // Legacy variations
    {
      name: 'Legacy chainId:1',
      tx: { type: 'legacy', chainId: 1, ...baseParams, gasPrice: 20_000_000_000n }
    },
    {
      name: 'Legacy chainId:96',
      tx: { type: 'legacy', chainId: 96, ...baseParams, gasPrice: 20_000_000_000n }
    },
    
    // Different gas prices
    {
      name: 'Legacy chainId:1 different gasPrice',
      tx: { type: 'legacy', chainId: 1, ...baseParams, gasPrice: 21_000_000_000n }
    },
    
    // Different values
    {
      name: 'Legacy chainId:1 zero value',
      tx: { type: 'legacy', chainId: 1, ...baseParams, value: 0n, gasPrice: 20_000_000_000n }
    },
    
    // Try with string values (as they appear in JSON)
    {
      name: 'Legacy chainId:1 string values',
      tx: { type: 'legacy', chainId: 1, to: baseParams.to, value: '100000000000000', data: '0x', nonce: 0, gas: '21000', gasPrice: '20000000000' }
    },
  ]
  
  for (const testCase of testCases) {
    console.log(`\n🧪 Testing: ${testCase.name}`)
    try {
      // Convert string values to BigInt if needed
      const txData = { ...testCase.tx }
      if (typeof txData.value === 'string') txData.value = BigInt(txData.value)
      if (typeof txData.gas === 'string') txData.gas = BigInt(txData.gas)
      if (typeof txData.gasPrice === 'string') txData.gasPrice = BigInt(txData.gasPrice)
      
      const unsigned = viemSerialize(txData)
      const digest = keccak256(getBytes(unsigned))
      
      console.log('  digest:', digest)
      
      // Try with yParity
      try {
        const from1 = recoverAddress(digest, { r, s, yParity })
        console.log('  ✅ recovered (yParity):', from1)
        if (from1.toLowerCase() === baseParams.to.toLowerCase()) {
          console.log('  🎯 MATCH! This is the correct transaction format!')
        }
      } catch (e) {
        console.log('  ❌ yParity failed:', e.message.split(' ')[0])
      }
      
      // Try with original v
      try {
        const from2 = recoverAddress(digest, { r, s, v: originalV })
        console.log('  ✅ recovered (orig v):', from2)
        if (from2.toLowerCase() === baseParams.to.toLowerCase()) {
          console.log('  🎯 MATCH! This is the correct transaction format!')
        }
      } catch (e) {
        console.log('  ❌ orig v failed:', e.message.split(' ')[0])
      }
      
    } catch (error) {
      console.log('  ❌ serialization failed:', error.message)
    }
  }
  
  console.log('\n🎯 Expected address:', baseParams.to)
}

testAllPossibleTransactions().catch(console.error)
