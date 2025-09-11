#!/usr/bin/env node

/**
 * Debug the new signature from VultiSig CLI
 */

import { JsonRpcProvider, keccak256, getBytes, recoverAddress, toBeHex } from 'ethers'
import { serializeTransaction as viemSerialize } from 'viem'

const provider = new JsonRpcProvider('https://ethereum-rpc.publicnode.com')

// Our signature from VultiSig CLI
const sig = '0xee4f870f1bd03267b24d3e6c2b8bb524dea63dc4aa99afbc90277ec429a70e13f147d11dc8c42ecc863f8dad919452aa2075dc13ee6166cb4fe6c6f7b10c84e4e3'

function parseSig(sig) {
  console.log('🔍 Signature analysis:')
  console.log('  Full signature:', sig)
  console.log('  Length:', sig.length, 'characters')
  
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new Error('Bad sig length/format')
  
  let r = '0x' + sig.slice(2, 66)
  let s = '0x' + sig.slice(66, 130)
  let v = parseInt(sig.slice(130, 132), 16)

  console.log('  r:', r)
  console.log('  s:', s)
  console.log('  v:', v, `(0x${v.toString(16)})`)
  
  // For EIP-155 legacy: chainId = (v - 35)/2
  const legacyChainId = Math.floor((v - 35) / 2)
  console.log('  Legacy EIP-155 chainId:', legacyChainId)
  
  // For EIP-1559, v should be 0 or 1 (yParity)
  const yParity = v & 1
  console.log('  yParity (v & 1):', yParity)
  
  return { r, s, v, yParity }
}

async function testDifferentFormats() {
  console.log('🧪 Testing Different Transaction Formats')
  console.log('=========================================\n')
  
  const { r, s, v, yParity } = parseSig(sig)
  
  const txData = {
    to: '0x3B47C2D0678F92ECd8f54192D14d541f28DDbE97',
    value: 100000000000000n, // 0.0001 ETH
    data: '0x',
    nonce: 0,
    gas: 21000n,
  }
  
  // Test 1: EIP-1559 with chainId 1
  console.log('\n🧪 Test 1: EIP-1559 transaction with chainId 1')
  try {
    const unsigned1 = viemSerialize({
      type: 'eip1559',
      chainId: 1,
      ...txData,
      maxFeePerGas: 20_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
      accessList: [],
    })
    
    const digest1 = keccak256(getBytes(unsigned1))
    console.log('  digest:', digest1)
    
    const from1 = recoverAddress(digest1, { r, s, yParity })
    console.log('  recovered from (yParity):', from1)
  } catch (error) {
    console.log('  ❌ Failed with yParity:', error.message)
  }
  
  // Test 2: EIP-1559 with chainId 96 (what the signature suggests)
  console.log('\n🧪 Test 2: EIP-1559 transaction with chainId 96')
  try {
    const unsigned2 = viemSerialize({
      type: 'eip1559',
      chainId: 96,
      ...txData,
      maxFeePerGas: 20_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n,
      accessList: [],
    })
    
    const digest2 = keccak256(getBytes(unsigned2))
    console.log('  digest:', digest2)
    
    const from2 = recoverAddress(digest2, { r, s, yParity })
    console.log('  recovered from (yParity):', from2)
  } catch (error) {
    console.log('  ❌ Failed with yParity:', error.message)
  }
  
  // Test 3: Legacy transaction with chainId 1
  console.log('\n🧪 Test 3: Legacy transaction with chainId 1')
  try {
    const unsigned3 = viemSerialize({
      type: 'legacy',
      chainId: 1,
      ...txData,
      gasPrice: 20_000_000_000n,
    })
    
    const digest3 = keccak256(getBytes(unsigned3))
    console.log('  digest:', digest3)
    
    const from3 = recoverAddress(digest3, { r, s, v })
    console.log('  recovered from (legacy v):', from3)
  } catch (error) {
    console.log('  ❌ Failed with legacy v:', error.message)
  }
  
  // Test 4: Legacy transaction with chainId 96
  console.log('\n🧪 Test 4: Legacy transaction with chainId 96')
  try {
    const unsigned4 = viemSerialize({
      type: 'legacy',
      chainId: 96,
      ...txData,
      gasPrice: 20_000_000_000n,
    })
    
    const digest4 = keccak256(getBytes(unsigned4))
    console.log('  digest:', digest4)
    
    const from4 = recoverAddress(digest4, { r, s, v })
    console.log('  recovered from (legacy v):', from4)
  } catch (error) {
    console.log('  ❌ Failed with legacy v:', error.message)
  }
  
  console.log('\n🎯 Expected address: 0x3B47C2D0678F92ECd8f54192D14d541f28DDbE97')
}

testDifferentFormats().catch(console.error)
