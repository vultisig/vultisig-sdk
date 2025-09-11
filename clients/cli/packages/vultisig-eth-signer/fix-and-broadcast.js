#!/usr/bin/env node

/**
 * Fix signature and broadcast
 */

import { JsonRpcProvider, keccak256, getBytes, recoverAddress, toBeHex } from 'ethers'
import { serializeTransaction as viemSerialize } from 'viem'

const provider = new JsonRpcProvider('https://ethereum-rpc.publicnode.com')

// Our LATEST signature from VultiSig CLI with CORRECT nonce 121
const sig = '0x917919a3c28806a552b312921ab54a1c6f61f59d47d20fa2d897501792f319b87ebf0bc677b07ad5c48e4089bf7028e4d2ad2fe6628698c923b0984e60a2fe0f95'

// Transaction parameters - using the CORRECT address and nonce
const to = '0x65261c9d3b49367e6a49902B1e735b2e734F8ee7'
const data = '0x'
const chainId = 1
let nonce = 121
let gasLimit = 21000n
let maxPriorityFeePerGas = 2_000_000_000n
let maxFeePerGas = 20_000_000_000n

function parseSig(sig) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new Error('Bad sig length/format')
  
  let r = '0x' + sig.slice(2, 66)
  let s = '0x' + sig.slice(66, 130)
  let v = parseInt(sig.slice(130, 132), 16)

  console.log('🔍 Original signature:')
  console.log('  r:', r)
  console.log('  s:', s)
  console.log('  v:', v, `(0x${v.toString(16)})`)
  
  // Normalize s to low-s (EIP-2)
  const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n
  const halfN = N >> 1n
  let yParity = v & 1
  let sBigInt = BigInt(s)
  
  console.log('  s as BigInt:', sBigInt.toString(16))
  console.log('  halfN:', halfN.toString(16))
  console.log('  s > halfN:', sBigInt > halfN)
  
  if (sBigInt > halfN) {
    sBigInt = N - sBigInt
    s = '0x' + sBigInt.toString(16).padStart(64, '0')
    yParity ^= 1
    console.log('  ✅ Normalized s:', s)
    console.log('  ✅ New yParity:', yParity)
  }
  
  return { r, s, yParity }
}

async function main() {
  console.log('🔧 Fix Signature and Broadcast')
  console.log('==============================\n')
  
  const { r, s, yParity } = parseSig(sig)

  // Build the UNSIGNED EIP-1559 transaction
  const unsigned = viemSerialize({
    type: 'eip1559',
    chainId,
    nonce,
    to,
    value: 100000000000000n, // 0.0001 ETH
    data,
    gas: gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    accessList: [],
  })

  console.log('\n🔧 Building EIP-1559 unsigned transaction...')
  console.log('  chainId:', chainId)
  console.log('  nonce:', nonce)
  console.log('  to:', to)
  console.log('  value: 0.0001 ETH')
  console.log('  gasLimit:', gasLimit.toString())
  console.log('  maxFeePerGas:', maxFeePerGas.toString())
  console.log('  unsigned length:', unsigned.length)

  // Compute the digest and recover the address
  const digest = keccak256(getBytes(unsigned))
  console.log('\n🔍 Signature recovery:')
  console.log('  digest:', digest)
  
  try {
    const from = recoverAddress(digest, { r, s, yParity })
    console.log('  ✅ recovered from:', from)
    console.log('  ✅ matches expected:', from.toLowerCase() === to.toLowerCase())
  } catch (error) {
    console.log('  ❌ Recovery failed:', error.message)
    return
  }

  // Check fees and nonce
  console.log('\n🔧 Checking fees and nonce...')
  const blk = await provider.getBlock('latest')
  const base = blk.baseFeePerGas ?? 0n
  console.log('  current base fee:', base.toString())
  console.log('  our maxFeePerGas:', maxFeePerGas.toString())
  
  if (maxFeePerGas <= base) {
    maxFeePerGas = base * 2n + maxPriorityFeePerGas
    console.log('  ⚠️  bumping maxFeePerGas to', toBeHex(maxFeePerGas))
  } else {
    console.log('  ✅ maxFeePerGas is sufficient')
  }
  
  const pendingNonce = await provider.getTransactionCount(to, 'pending')
  console.log('  pending nonce:', pendingNonce)
  console.log('  our nonce:', nonce)
  
  if (pendingNonce !== nonce) {
    nonce = pendingNonce
    console.log('  ⚠️  fixing nonce to', nonce)
    
    // Need to re-sign with new nonce - for now just warn
    console.log('  ⚠️  WARNING: Nonce changed, signature is now invalid!')
    console.log('  ⚠️  You need to generate a new signature with nonce', nonce)
    return
  } else {
    console.log('  ✅ nonce is correct')
  }

  // Create signed transaction
  console.log('\n🔧 Creating signed transaction...')
  const raw = viemSerialize({
    type: 'eip1559',
    chainId,
    nonce,
    to,
    value: 100000000000000n, // 0.0001 ETH
    data,
    gas: gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    accessList: [],
    signature: { r, s, yParity },
  })

  console.log('  raw tx length:', raw.length)
  console.log('  raw tx preview:', raw.slice(0, 40) + '...')
  
  console.log('\n🚀 Broadcasting transaction...')
  try {
    const resp = await provider.broadcastTransaction(raw)
    console.log('✅ Transaction broadcasted!')
    console.log('  hash:', resp.hash)
    console.log('  waiting for confirmation...')
    const rec = await resp.wait()
    console.log('✅ Transaction mined!')
    console.log('  block:', rec.blockNumber)
    console.log('  gas used:', rec.gasUsed.toString())
  } catch (error) {
    console.log('❌ Broadcast failed:', error.message)
    
    if (error.message.includes('nonce too low')) {
      console.log('\n💡 Nonce too low - transaction already exists or nonce changed')
    } else if (error.message.includes('insufficient funds')) {
      console.log('\n💡 Insufficient funds for gas + value')
    } else if (error.message.includes('invalid sender')) {
      console.log('\n💡 Invalid sender - signature mismatch')
    }
  }
}

main().catch(console.error)
