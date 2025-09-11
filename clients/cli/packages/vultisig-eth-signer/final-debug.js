#!/usr/bin/env node

/**
 * Final comprehensive debug to understand the signature issue
 */

import { JsonRpcProvider, keccak256, getBytes, recoverAddress, toBeHex } from 'ethers'
import { serializeTransaction as viemSerialize } from 'viem'

const provider = new JsonRpcProvider('https://ethereum-rpc.publicnode.com')

// Our latest signature
const sig = '0x8437ae23b5858557633ea4310c088637fe842ae289710ba63b4782b78538f539b14a53b0a504785908c61a5ada56bfa37826cae2fc8a79d4886c557183cf636fae'

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

async function testAllPossibleScenarios() {
  console.log('🧪 Final Comprehensive Debug')
  console.log('===========================\n')
  
  const { r, s, yParity } = parseAndNormalizeSig(sig)
  
  // The addresses we know about
  const addresses = {
    daemon: '0x65261c9d3b49367e6a49902B1e735b2e734F8ee7',
    recovered_before: '0xF37328204822E1396e722483b0Ab9cB2dD1B6A62',
    old_target: '0x3B47C2D0678F92ECd8f54192D14d541f28DDbE97'
  }
  
  console.log('📍 Known addresses:')
  Object.entries(addresses).forEach(([key, addr]) => {
    console.log(`  ${key}: ${addr}`)
  })
  
  // Test different transaction scenarios
  const scenarios = [
    {
      name: 'EIP-1559 to daemon address',
      tx: {
        type: 'eip1559',
        chainId: 1,
        nonce: 0,
        to: addresses.daemon,
        value: 100000000000000n,
        data: '0x',
        gas: 21000n,
        maxFeePerGas: 20_000_000_000n,
        maxPriorityFeePerGas: 2_000_000_000n,
        accessList: [],
      }
    },
    {
      name: 'Legacy to daemon address',
      tx: {
        type: 'legacy',
        chainId: 1,
        nonce: 0,
        to: addresses.daemon,
        value: 100000000000000n,
        data: '0x',
        gas: 21000n,
        gasPrice: 20_000_000_000n,
      }
    },
    {
      name: 'EIP-1559 to old target',
      tx: {
        type: 'eip1559',
        chainId: 1,
        nonce: 0,
        to: addresses.old_target,
        value: 100000000000000n,
        data: '0x',
        gas: 21000n,
        maxFeePerGas: 20_000_000_000n,
        maxPriorityFeePerGas: 2_000_000_000n,
        accessList: [],
      }
    },
    {
      name: 'EIP-1559 self-to-self (daemon)',
      tx: {
        type: 'eip1559',
        chainId: 1,
        nonce: 0,
        to: addresses.daemon,
        value: 100000000000000n,
        data: '0x',
        gas: 21000n,
        maxFeePerGas: 20_000_000_000n,
        maxPriorityFeePerGas: 2_000_000_000n,
        accessList: [],
      }
    }
  ]
  
  for (const scenario of scenarios) {
    console.log(`\n🧪 Testing: ${scenario.name}`)
    try {
      const unsigned = viemSerialize(scenario.tx)
      const digest = keccak256(getBytes(unsigned))
      
      console.log(`  Digest: ${digest}`)
      console.log(`  Unsigned: ${unsigned}`)
      
      try {
        const recovered = recoverAddress(digest, { r, s, yParity })
        console.log(`  ✅ Recovered: ${recovered}`)
        
        // Check if it matches any known address
        const match = Object.entries(addresses).find(([, addr]) => 
          addr.toLowerCase() === recovered.toLowerCase()
        )
        
        if (match) {
          console.log(`  🎯 MATCH! Recovered address matches ${match[0]}`)
        } else {
          console.log(`  ❓ No match with known addresses`)
        }
        
      } catch (recoverError) {
        console.log(`  ❌ Recovery failed: ${recoverError.message.split(' ')[0]}`)
      }
      
    } catch (error) {
      console.log(`  ❌ Serialization failed: ${error.message}`)
    }
  }
  
  // Test if the issue might be with the message hash calculation itself
  console.log('\n🔍 Testing message hash calculation approaches:')
  
  // Approach 1: What the old CLI was doing (SHA-256 of JSON)
  const oldApproach = JSON.stringify({
    to: addresses.daemon,
    value: '100000000000000',
    gas: '21000',
    maxFeePerGas: '20000000000',
    maxPriorityFeePerGas: '2000000000',
    data: '0x',
    nonce: 0,
    chainId: 1,
    type: 2
  })
  
  const { createHash } = await import('crypto')
  const oldHash = createHash('sha256').update(oldApproach).digest('hex')
  console.log('\n📝 Old approach (SHA-256 of JSON):')
  console.log(`  JSON: ${oldApproach}`)
  console.log(`  Hash: ${oldHash}`)
  
  try {
    const oldRecovered = recoverAddress('0x' + oldHash, { r, s, yParity })
    console.log(`  ✅ Old approach recovered: ${oldRecovered}`)
    
    const oldMatch = Object.entries(addresses).find(([, addr]) => 
      addr.toLowerCase() === oldRecovered.toLowerCase()
    )
    
    if (oldMatch) {
      console.log(`  🎯 OLD APPROACH MATCH! This confirms the CLI was using the old method`)
    }
    
  } catch (error) {
    console.log(`  ❌ Old approach recovery failed: ${error.message.split(' ')[0]}`)
  }
}

testAllPossibleScenarios().catch(console.error)
