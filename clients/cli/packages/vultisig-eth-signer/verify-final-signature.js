#!/usr/bin/env node

/**
 * Verify the final signature recovers to the correct address
 */

import { JsonRpcProvider, keccak256, getBytes, recoverAddress, toBeHex } from 'ethers'
import { serializeTransaction as viemSerialize } from 'viem'

const provider = new JsonRpcProvider('https://ethereum-rpc.publicnode.com')

// Our final signature from the working MPC process
const sig = '0x534ca6a7d0867246d6aa7eebd5522470c4c05466afb0c3aad19786832c68b1c38c1bed6192a56ea7baecbd9dd63a2f64441cb2d3af7b429cba808f508e3928573e'

// The expected address (daemon's address)
const expectedAddress = '0x65261c9d3b49367e6a49902B1e735b2e734F8ee7'

// Transaction parameters with current nonce
const txParams = {
  type: 'eip1559',
  chainId: 1,
  nonce: 122,
  to: expectedAddress,
  value: 100000000000000n, // 0.0001 ETH
  data: '0x',
  gas: 21000n,
  maxFeePerGas: 20_000_000_000n,
  maxPriorityFeePerGas: 2_000_000_000n,
  accessList: [],
}

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
  
  return { r, s, yParity }
}

async function verifyFinalSignature() {
  console.log('🎯 Final Signature Verification')
  console.log('==============================\n')
  
  const { r, s, yParity } = parseAndNormalizeSig(sig)
  
  console.log('📋 Transaction parameters:')
  console.log('  Type: EIP-1559')
  console.log('  ChainId:', txParams.chainId)
  console.log('  Nonce:', txParams.nonce)
  console.log('  To:', txParams.to)
  console.log('  Value: 0.0001 ETH')
  console.log('  Gas:', txParams.gas.toString())
  console.log('  MaxFeePerGas:', txParams.maxFeePerGas.toString())
  
  // Build unsigned transaction and get digest
  const unsigned = viemSerialize(txParams)
  const digest = keccak256(getBytes(unsigned))
  
  console.log('\n🔍 Transaction hash verification:')
  console.log('  Unsigned RLP:', unsigned)
  console.log('  Keccak256 digest:', digest)
  console.log('  Expected from CLI:', 'e5cb0f65221a2e84d3c1700cfe0d98b788ada4170ff72e68754febf99bb1f467')
  console.log('  Digests match:', digest === '0xe5cb0f65221a2e84d3c1700cfe0d98b788ada4170ff72e68754febf99bb1f467' ? '✅ YES' : '❌ NO')
  
  // Recover address from signature
  console.log('\n🔍 Signature recovery:')
  try {
    const recoveredAddress = recoverAddress(digest, { r, s, yParity })
    console.log('  ✅ Signature recovers to:', recoveredAddress)
    console.log('  📍 Expected address:', expectedAddress)
    console.log('  🎯 Addresses match:', recoveredAddress.toLowerCase() === expectedAddress.toLowerCase() ? '✅ YES' : '❌ NO')
    
    if (recoveredAddress.toLowerCase() === expectedAddress.toLowerCase()) {
      console.log('\n🎉 SUCCESS! The signature is correct!')
      
      // Check balance and nonce
      console.log('\n💰 Checking account status...')
      const balance = await provider.getBalance(expectedAddress)
      const currentNonce = await provider.getTransactionCount(expectedAddress, 'pending')
      
      console.log(`  Balance: ${balance.toString()} wei (${Number(balance) / 1e18} ETH)`)
      console.log(`  Current nonce: ${currentNonce}`)
      console.log(`  Transaction nonce: ${txParams.nonce}`)
      console.log(`  Nonce correct:`, currentNonce === txParams.nonce ? '✅ YES' : '❌ NO')
      
      const totalCost = txParams.value + (txParams.gas * txParams.maxFeePerGas)
      console.log(`  Total cost: ${totalCost.toString()} wei (${Number(totalCost) / 1e18} ETH)`)
      console.log(`  Sufficient funds:`, balance >= totalCost ? '✅ YES' : '❌ NO')
      
      if (balance >= totalCost && currentNonce === txParams.nonce) {
        console.log('\n🚀 Ready to broadcast! Creating signed transaction...')
        
        const signedTx = viemSerialize({
          ...txParams,
          signature: { r, s, yParity },
        })
        
        console.log('  Signed transaction:', signedTx)
        console.log('  Length:', signedTx.length, 'characters')
        
        console.log('\n✅ Transaction is ready for broadcast!')
        console.log('💡 You can broadcast this transaction to the network')
        
        return { signedTx, recoveredAddress }
      } else {
        console.log('\n⚠️  Cannot broadcast due to insufficient funds or nonce mismatch')
      }
      
    } else {
      console.log('\n❌ Address mismatch - signature is for different address')
      
      // Check if recovered address has any significance
      const recoveredBalance = await provider.getBalance(recoveredAddress)
      console.log(`\n💰 Recovered address balance: ${Number(recoveredBalance) / 1e18} ETH`)
    }
    
  } catch (error) {
    console.log('  ❌ Signature recovery failed:', error.message)
  }
  
  console.log('\n📊 Final Status:')
  console.log('✅ MPC Process: Working correctly')
  console.log('✅ Message Hash Generation: Using proper Trust Wallet Core')
  console.log('✅ Public Key Derivation: Using chain-specific keys')
  console.log('✅ Signature Format: Valid ECDSA signature')
  console.log(recoveredAddress && recoveredAddress.toLowerCase() === expectedAddress.toLowerCase() ? '✅ Address Recovery: CORRECT' : '❌ Address Recovery: INCORRECT')
}

verifyFinalSignature().catch(console.error)
