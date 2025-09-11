#!/usr/bin/env node

/**
 * Verify address derivation using Trust Wallet Core
 * This will show us what address the chain-specific public key should derive to
 */

async function verifyAddressDerivation() {
  console.log('🔍 Address Derivation Verification')
  console.log('==================================\n')
  
  try {
    // Import Trust Wallet Core
    const { initWasm } = await import('@trustwallet/wallet-core')
    const walletCore = await initWasm()
    
    // The vault's keys
    const masterEcdsaKey = '027b25c8ea94b53daa502be1f112201bcc29eb197d28eba6af2344c023ae3aeea4'
    const chainSpecificKey = '0259a3db462694394d1aaa69fb2f6683919dcd5bbea01d5721154f7f8a0dcbeb7f'
    const hexChainCode = 'd0e7e21350cd9fbe0e40ef9b6b1e8d5f040084fb6d66d88fbeebffb284b22d31'
    const daemonAddress = '0x65261c9d3b49367e6a49902B1e735b2e734F8ee7'
    const signatureRecoveredAddress = '0xdd91e9b8b8D8056CD55ad2411d17E366fbc1f12D'
    
    console.log('🔑 Key Information:')
    console.log('  Master ECDSA Key:', masterEcdsaKey)
    console.log('  Chain-Specific Key:', chainSpecificKey)
    console.log('  Hex Chain Code:', hexChainCode)
    console.log('  Daemon Address:', daemonAddress)
    console.log('  Signature Recovered:', signatureRecoveredAddress)
    
    // Test 1: What does the master key derive to directly?
    console.log('\n🧪 Test 1: Master key direct derivation')
    try {
      const masterKeyBytes = Buffer.from(masterEcdsaKey, 'hex')
      const masterPublicKey = walletCore.PublicKey.createWithData(
        masterKeyBytes,
        walletCore.PublicKeyType.secp256k1
      )
      
      const masterAddress = walletCore.CoinTypeExt.deriveAddressFromPublicKey(
        walletCore.CoinType.ethereum,
        masterPublicKey
      )
      
      console.log('  Master key derives to:', masterAddress)
      console.log('  Matches daemon:', masterAddress.toLowerCase() === daemonAddress.toLowerCase() ? '✅ YES' : '❌ NO')
      console.log('  Matches signature:', masterAddress.toLowerCase() === signatureRecoveredAddress.toLowerCase() ? '✅ YES' : '❌ NO')
      
    } catch (error) {
      console.log('  ❌ Failed:', error.message)
    }
    
    // Test 2: What does the chain-specific key derive to?
    console.log('\n🧪 Test 2: Chain-specific key derivation')
    try {
      const chainKeyBytes = Buffer.from(chainSpecificKey, 'hex')
      const chainPublicKey = walletCore.PublicKey.createWithData(
        chainKeyBytes,
        walletCore.PublicKeyType.secp256k1
      )
      
      const chainAddress = walletCore.CoinTypeExt.deriveAddressFromPublicKey(
        walletCore.CoinType.ethereum,
        chainPublicKey
      )
      
      console.log('  Chain-specific key derives to:', chainAddress)
      console.log('  Matches daemon:', chainAddress.toLowerCase() === daemonAddress.toLowerCase() ? '✅ YES' : '❌ NO')
      console.log('  Matches signature:', chainAddress.toLowerCase() === signatureRecoveredAddress.toLowerCase() ? '✅ YES' : '❌ NO')
      
    } catch (error) {
      console.log('  ❌ Failed:', error.message)
    }
    
    // Test 3: Derive the chain-specific key manually and check
    console.log('\n🧪 Test 3: Manual chain-specific key derivation')
    try {
      const { derivePublicKey } = await import('@core/chain/publicKey/ecdsa/derivePublicKey')
      
      const coinType = walletCore.CoinType.ethereum
      const derivationPath = walletCore.CoinTypeExt.derivationPath(coinType)
      
      console.log('  Ethereum derivation path:', derivationPath)
      
      const manualDerivedKey = derivePublicKey({
        hexRootPubKey: masterEcdsaKey,
        hexChainCode: hexChainCode,
        path: derivationPath,
      })
      
      console.log('  Manual derived key:', manualDerivedKey)
      console.log('  Matches chain-specific:', manualDerivedKey === chainSpecificKey ? '✅ YES' : '❌ NO')
      
      // Derive address from manual key
      const manualKeyBytes = Buffer.from(manualDerivedKey, 'hex')
      const manualPublicKey = walletCore.PublicKey.createWithData(
        manualKeyBytes,
        walletCore.PublicKeyType.secp256k1
      )
      
      const manualAddress = walletCore.CoinTypeExt.deriveAddressFromPublicKey(
        walletCore.CoinType.ethereum,
        manualPublicKey
      )
      
      console.log('  Manual derived address:', manualAddress)
      console.log('  Matches daemon:', manualAddress.toLowerCase() === daemonAddress.toLowerCase() ? '✅ YES' : '❌ NO')
      console.log('  Matches signature:', manualAddress.toLowerCase() === signatureRecoveredAddress.toLowerCase() ? '✅ YES' : '❌ NO')
      
    } catch (error) {
      console.log('  ❌ Failed:', error.message)
    }
    
    console.log('\n🎯 Conclusion:')
    console.log('We need to find which key derivation method produces the daemon address')
    console.log('and ensure the VultiServer uses the same method for signing.')
    
  } catch (error) {
    console.log('❌ Failed to load Trust Wallet Core:', error.message)
  }
}

verifyAddressDerivation().catch(console.error)
