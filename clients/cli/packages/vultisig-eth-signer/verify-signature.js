#!/usr/bin/env node

/**
 * Verify the signature from CLI signing test
 */

import { getBytes, keccak256, recoverAddress } from 'ethers'
import { serializeTransaction as viemSerialize } from 'viem'

const signature =
  '0x3b4899cde68ec2bfd3e37b1ed82c5c7072f123c2c4664278962eb4e1f599e549ea42aa756cef198ef2377469c4624d6144fd19d4230a51c1eb35461a5cff78797d'
const expectedAddress = '0x65261c9d3b49367e6a49902B1e735b2e734F8ee7'

const payload = {
  to: '0x65261c9d3b49367e6a49902B1e735b2e734F8ee7',
  value: '1000000000000000',
  data: '0x',
  gasLimit: '21000',
  gasPrice: '20000000000',
  nonce: 122,
  type: 2,
  chainId: 1,
  maxFeePerGas: '20000000000',
  maxPriorityFeePerGas: '2000000000',
}

function normalizeSignature(sig) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) {
    throw new Error('Invalid signature format')
  }

  let r = '0x' + sig.slice(2, 66)
  let s = '0x' + sig.slice(66, 130)
  let v = parseInt(sig.slice(130, 132), 16)

  console.log('📊 Raw signature components:')
  console.log('  r:', r)
  console.log('  s:', s)
  console.log('  v:', v)
  console.log('  v (binary):', v.toString(2).padStart(8, '0'))

  // Normalize s to low-s (EIP-2)
  const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
  const halfN = N >> 1n
  let sBigInt = BigInt(s)

  console.log('🔍 S value analysis:')
  console.log('  s (decimal):', sBigInt.toString())
  console.log('  halfN (decimal):', halfN.toString())
  console.log('  s > halfN:', sBigInt > halfN)

  if (sBigInt > halfN) {
    console.log('⚠️  S value is high, normalizing...')
    sBigInt = N - sBigInt
    s = '0x' + sBigInt.toString(16).padStart(64, '0')

    // Flip recovery bit
    v ^= 1

    console.log('✅ Normalized signature:')
    console.log('  new s:', s)
    console.log('  new v:', v)
  } else {
    console.log('✅ S value is already low (canonical)')
  }

  return { r, s, v }
}

async function verifySignature() {
  console.log('🔍 Verifying Signature from CLI')
  console.log('===============================\n')

  console.log('📝 Signature:', signature)
  console.log('🎯 Expected address:', expectedAddress)

  // Normalize signature
  const { r, s, v } = normalizeSignature(signature)

  // Create transaction hash using viem
  const viemTx = {
    type: 'eip1559',
    chainId: payload.chainId,
    nonce: payload.nonce,
    to: payload.to,
    value: BigInt(payload.value),
    data: payload.data,
    gas: BigInt(payload.gasLimit),
    maxFeePerGas: BigInt(payload.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(payload.maxPriorityFeePerGas),
    accessList: [],
  }

  console.log('\n📋 Transaction for hashing:')
  console.log(
    JSON.stringify(
      viemTx,
      (k, v) => (typeof v === 'bigint' ? v.toString() : v),
      2
    )
  )

  const serialized = viemSerialize(viemTx)
  const txHash = keccak256(getBytes(serialized))

  console.log('\n📊 Transaction details:')
  console.log('  Serialized:', serialized)
  console.log('  Hash:', txHash)

  try {
    // Try to recover address with normalized signature
    console.log('\n🔍 Attempting address recovery...')
    const recoveredAddress = recoverAddress(txHash, { r, s, v })

    console.log('✅ Address recovered successfully!')
    console.log('🔍 Recovered address:', recoveredAddress)
    console.log('🎯 Expected address: ', expectedAddress)

    if (recoveredAddress.toLowerCase() === expectedAddress.toLowerCase()) {
      console.log('🎉 SIGNATURE VERIFICATION SUCCESSFUL!')
      console.log('✅ The signature is valid and matches the expected address')

      return {
        valid: true,
        signature: `${r}${s.slice(2)}${v.toString(16).padStart(2, '0')}`,
        recoveredAddress,
        txHash,
      }
    } else {
      console.log('❌ SIGNATURE VERIFICATION FAILED!')
      console.log('   Recovered address does not match expected address')

      return {
        valid: false,
        signature: `${r}${s.slice(2)}${v.toString(16).padStart(2, '0')}`,
        recoveredAddress,
        expectedAddress,
        txHash,
      }
    }
  } catch (error) {
    console.error('❌ Error during address recovery:', error.message)

    // Try different v values
    console.log('\n🔄 Trying alternative v values...')
    for (const altV of [27, 28, 0, 1]) {
      try {
        const altRecovered = recoverAddress(txHash, { r, s, v: altV })
        console.log(`  v=${altV}: ${altRecovered}`)

        if (altRecovered.toLowerCase() === expectedAddress.toLowerCase()) {
          console.log(`🎉 SUCCESS with v=${altV}!`)
          return {
            valid: true,
            signature: `${r}${s.slice(2)}${altV.toString(16).padStart(2, '0')}`,
            recoveredAddress: altRecovered,
            txHash,
          }
        }
      } catch (e) {
        console.log(`  v=${altV}: Error - ${e.message}`)
      }
    }

    return {
      valid: false,
      error: error.message,
      txHash,
    }
  }
}

verifySignature()
  .then(result => {
    if (result.valid) {
      console.log('\n🎊 FINAL RESULT: SIGNATURE IS VALID!')
      console.log(`📝 Normalized signature: ${result.signature}`)
      console.log(`🔗 Transaction hash: ${result.txHash}`)
      console.log(`📍 Recovered address: ${result.recoveredAddress}`)
    } else {
      console.log('\n💥 FINAL RESULT: SIGNATURE VERIFICATION FAILED')
      if (result.error) {
        console.log(`❌ Error: ${result.error}`)
      }
    }
  })
  .catch(console.error)
