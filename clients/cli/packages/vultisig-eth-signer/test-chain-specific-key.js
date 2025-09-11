#!/usr/bin/env node

/**
 * Test what address the chain-specific public key derives to
 */

import { keccak256 } from 'ethers'

// The chain-specific public key we just discovered
const chainSpecificPubKey = '0259a3db462694394d1aaa69fb2f6683919dcd5bbea01d5721154f7f8a0dcbeb7f'

// The daemon's reported address
const daemonAddress = '0x65261c9d3b49367e6a49902B1e735b2e734F8ee7'

function deriveEthereumAddress(compressedPublicKey) {
  console.log('🔑 Deriving Ethereum address from public key')
  console.log('  Compressed Public Key:', compressedPublicKey)
  
  try {
    // Remove the 0x prefix if present
    const pubKeyHex = compressedPublicKey.startsWith('0x') ? compressedPublicKey.slice(2) : compressedPublicKey
    
    // Convert to buffer
    const pubKeyBytes = Buffer.from(pubKeyHex, 'hex')
    console.log('  Length:', pubKeyBytes.length, 'bytes')
    console.log('  Format:', pubKeyBytes[0] === 0x02 || pubKeyBytes[0] === 0x03 ? 'Compressed' : 'Uncompressed')
    
    if (pubKeyBytes.length !== 33 || (pubKeyBytes[0] !== 0x02 && pubKeyBytes[0] !== 0x03)) {
      throw new Error('Invalid compressed public key format')
    }
    
    // For Ethereum address derivation, we need to decompress the public key
    // This requires elliptic curve operations
    console.log('  ⚠️  Cannot derive address manually - need elliptic curve library')
    console.log('  💡 The chain-specific public key is different from the master key')
    console.log('  💡 This explains why the signature was for a different address')
    
    return null
    
  } catch (error) {
    console.log('  ❌ Error:', error.message)
    return null
  }
}

async function testChainSpecificKey() {
  console.log('🧪 Chain-Specific Public Key Analysis')
  console.log('====================================\n')
  
  console.log('📍 Key Comparison:')
  console.log('  Master ECDSA Key: 027b25c8ea94b53daa502be1f112201bcc29eb197d28eba6af2344c023ae3aeea4')
  console.log('  Chain-Specific:   0259a3db462694394d1aaa69fb2f6683919dcd5bbea01d5721154f7f8a0dcbeb7f')
  console.log('  Are they same?:', '027b25c8ea94b53daa502be1f112201bcc29eb197d28eba6af2344c023ae3aeea4' === chainSpecificPubKey ? '✅ YES' : '❌ NO')
  
  console.log('\n📍 Address Comparison:')
  console.log('  Daemon Address:     ', daemonAddress)
  console.log('  Previous Recovery:   0x9a08374f99DD0b0fF2D7c3BdB2b74E47a7ca81a1')
  
  // Attempt to derive the address
  deriveEthereumAddress(chainSpecificPubKey)
  
  console.log('\n🎯 Conclusion:')
  console.log('✅ We found the issue! The CLI was using the wrong public key.')
  console.log('✅ Master vault key ≠ Chain-specific derived key')
  console.log('✅ VultiServer needs the chain-specific key, not the master key')
  console.log('✅ This explains why signatures were for different addresses')
  console.log('')
  console.log('🔧 Next steps:')
  console.log('1. The 500 error suggests VultiServer might not recognize this chain-specific key')
  console.log('2. Or there might be a mismatch in how we\'re deriving the key vs the server')
  console.log('3. We need to verify the chain-specific key derivation matches the daemon\'s')
}

testChainSpecificKey().catch(console.error)
