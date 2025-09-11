#!/usr/bin/env node

/**
 * Verify signature preimage and broadcast
 * Based on the user's fix for the chainId/transaction type mismatch
 */

import { JsonRpcProvider, keccak256, getBytes, recoverAddress, toBeHex } from 'ethers'
import { serializeTransaction as viemSerialize } from 'viem'

const provider = new JsonRpcProvider('https://ethereum-rpc.publicnode.com')

// Fresh signature from VultiSig CLI for our 0.0001 ETH EIP-1559 self-to-self transaction
const sig = '0xee4f870f1bd03267b24d3e6c2b8bb524dea63dc4aa99afbc90277ec429a70e13f147d11dc8c42ecc863f8dad919452aa2075dc13ee6166cb4fe6c6f7b10c84e4e3'

// tx fields MUST be exactly what was signed - 0.0001 ETH self-to-self
const to = '0x3B47C2D0678F92ECd8f54192D14d541f28DDbE97'
const data = '0x'
const chainId = 1
let nonce = 0
let gasLimit = 21000n
let maxPriorityFeePerGas = 2_000_000_000n
let maxFeePerGas = 20_000_000_000n

function parseSig(sig) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new Error('Bad sig length/format')
  let r = '0x' + sig.slice(2, 66)
  let s = '0x' + sig.slice(66, 130)
  let v = parseInt(sig.slice(130, 132), 16) // 0xed here -> legacy EIP-155 style

  console.log('🔍 Signature analysis:')
  console.log('  r:', r)
  console.log('  s:', s)
  console.log('  v:', v, `(0x${v.toString(16)})`)
  
  // For EIP-155 legacy: chainId = (v - 35)/2
  const legacyChainId = Math.floor((v - 35) / 2)
  console.log('  Legacy EIP-155 chainId:', legacyChainId)
  console.log('  ⚠️  This signature is for chainId', legacyChainId, 'not chainId 1!')

  // normalise to low-s and yParity
  const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n
  const halfN = N >> 1n
  let yParity = v & 1
  let sBI = BigInt(s)
  if (sBI > halfN) {
    sBI = N - sBI
    s = '0x' + sBI.toString(16).padStart(64, '0')
    yParity ^= 1
  }
  return { r, s, yParity }
}

async function main() {
  console.log('🧪 Verify Signature Preimage and Broadcast')
  console.log('=========================================\n')
  
  const { r, s, yParity } = parseSig(sig)

  // Build the UNSIGNED type-2 payload (this is the thing that was supposed to be signed)
  const unsigned = viemSerialize({
    type: 'eip1559',
    chainId,
    nonce,
    to,
    value: 100000000000000n, // 0.0001 ETH in wei
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
  console.log('  gasLimit:', gasLimit.toString())
  console.log('  maxFeePerGas:', maxFeePerGas.toString())
  console.log('  unsigned length:', unsigned.length)

  // Compute the EIP-1559 signing digest and recover the address
  const digest = keccak256(getBytes(unsigned))
  const from = recoverAddress(digest, { r, s, yParity })
  console.log('\n🔍 Signature recovery:')
  console.log('  digest:', digest)
  console.log('  recovered from:', from)

  // Sanity: make fees viable and nonce correct
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
  
  const pendingNonce = await provider.getTransactionCount(from, 'pending')
  console.log('  pending nonce:', pendingNonce)
  console.log('  our nonce:', nonce)
  
  if (pendingNonce !== nonce) {
    nonce = pendingNonce
    console.log('  ⚠️  fixing nonce to', nonce)
  } else {
    console.log('  ✅ nonce is correct')
  }

  // Re-serialise with the signature to get raw tx
  console.log('\n🔧 Creating signed transaction...')
  const raw = viemSerialize({
    type: 'eip1559',
    chainId,
    nonce,
    to,
    value: 100000000000000n, // 0.0001 ETH in wei
    data,
    gas: gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    accessList: [],
    signature: { r, s, yParity },
  })

  console.log('  raw tx length:', raw.length)
  console.log('  raw tx preview:', raw.slice(0, 20) + '…')
  
  console.log('\n🚀 Broadcasting transaction...')
  try {
    const resp = await provider.broadcastTransaction(raw)
    console.log('✅ Transaction broadcasted!')
    console.log('  hash:', resp.hash)
    console.log('  waiting for confirmation...')
    const rec = await resp.wait()
    console.log('✅ Transaction mined!')
    console.log('  block:', rec.blockNumber)
  } catch (error) {
    console.log('❌ Broadcast failed:', error.message)
    
    if (error.message.includes('invalid sender')) {
      console.log('\n💡 This confirms the signature mismatch!')
      console.log('   The signature is for a different transaction preimage.')
      console.log('   We need a fresh signature for the EIP-1559 transaction on chainId 1.')
    }
  }
}

main().catch(console.error)
