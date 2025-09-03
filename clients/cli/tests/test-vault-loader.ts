import { VaultLoader } from '../src/vault/VaultLoader'
import * as path from 'path'

// Expected test data from keyshare-details JSON files
const EXPECTED_TEST_DATA = {
  'TestFastVault-44fd-share1of2-Vultiserver.vult': {
    name: 'TestFastVault',
    localPartyId: 'Server-94060', // Different for share1 vs share2 
    signers: ['Server-94060', 'iPhone-5C9'],
    libType: 1, // DKLS
    publicKeys: {
      ecdsa: '03ac0f333fc5d22f929e013be80988f57a56837db64d968c126ca4c943984744fd',
      eddsa: 'dff9b5b456eadcbd99366fd691f50f865a26df433f9cbffe1b6f319ecadb8308'
    },
    hexChainCode: 'c39c57cd4127a5c5d6c8583f3f12d7be26e7eed8c398e7ee9926cd33845cae1b',
    expectedAddresses: {
      Bitcoin: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
      Ethereum: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
      THORChain: 'thor1nuwfr59wyn6da6v5ktxsa32v2t6u2q4veg9awu',
      Cosmos: 'cosmos1axf2e8w0k73gp7zmfqcx7zssma34haxh7xwlsu',
      Solana: 'G5Jm9g1NH1xprPz3ZpnNmF8Wkz2F6YUhkxpf432mRefR'
    }
  },
  'TestSecureVault-cfa0-share2of2-Nopassword.vult': {
    name: 'TestSecureVault', 
    localPartyId: "jp's MacBook Air-EE5",
    signers: ['iPhone-5C9', "jp's MacBook Air-EE5"],
    libType: 1, // DKLS
    publicKeys: {
      ecdsa: '03165c66e1c84d4d5b761e3061d311f2b4e63009b354e4b18fecb9657a0397cfa0',
      eddsa: '46a663e9c21de660f7b103d5cb669be2109a4d6e2171045b7be82423175a4ee5'
    },
    hexChainCode: 'd8eb76b83dca3a7cdcfaee11c40f5702193f6a988ebc1b05215a3a28ec9910b3',
    expectedAddresses: {
      Bitcoin: 'bc1qg7gldwlccw9qeyzpew37hetu2ys042wnu2n3l4',
      Ethereum: '0x3B47C2D0678F92ECd8f54192D14d541f28DDbE97',
      THORChain: 'thor15q49a2nt8zehfmlaypjdm4wyja8a9pruuhsf6m',
      Cosmos: 'cosmos1qjajscnnvmpv0yufupqjr6jq6h5cadl9fx0y4n',
      Solana: '5knhKqfmWuf6QJb4kwcUP47K9QpUheaxBbvDpNLVqCZz'
    }
  }
}

async function runVaultLoaderTests() {
  const loader = new VaultLoader()
  const keyshareDir = path.join(__dirname, 'keyshares')
  
  console.log('🧪 VaultLoader Test Suite')
  console.log('==========================\n')
  
  let totalTests = 0
  let passedTests = 0
  
  for (const [filename, expected] of Object.entries(EXPECTED_TEST_DATA)) {
    const filePath = path.join(keyshareDir, filename)
    
    console.log(`📁 Testing: ${filename}`)
    console.log('─'.repeat(50))
    
    try {
      // Test 1: File exists
      totalTests++
      const exists = await loader.exists(filePath)
      if (exists) {
        console.log('✅ File exists')
        passedTests++
      } else {
        console.log('❌ File not found')
        continue
      }
      
      // Test 2: Check encryption status
      totalTests++
      const isUnencrypted = await loader.checkIfUnencrypted(filePath)
      if (isUnencrypted) {
        console.log('✅ File is unencrypted (as expected)')
        passedTests++
      } else {
        console.log('❌ File appears encrypted (unexpected)')
      }
      
      // Test 3: Get vault info
      totalTests++
      const vaultInfo = await loader.getVaultInfo(filePath)
      if (vaultInfo.name === expected.name) {
        console.log(`✅ Vault name matches: "${vaultInfo.name}"`)
        passedTests++
      } else {
        console.log(`❌ Vault name mismatch: got "${vaultInfo.name}", expected "${expected.name}"`)
      }
      
      // Test 4: Signers match
      totalTests++
      const signersMatch = vaultInfo.signers.length === expected.signers.length &&
        vaultInfo.signers.every(s => expected.signers.includes(s))
      if (signersMatch) {
        console.log(`✅ Signers match: [${vaultInfo.signers.join(', ')}]`)
        passedTests++
      } else {
        console.log(`❌ Signers mismatch: got [${vaultInfo.signers.join(', ')}], expected [${expected.signers.join(', ')}]`)
      }
      
      // Test 5: Load full vault data
      totalTests++
      const vaultData = await loader.loadVaultFromFile(filePath)
      if (vaultData) {
        console.log('✅ Vault data loaded successfully')
        passedTests++
      } else {
        console.log('❌ Failed to load vault data')
        continue
      }
      
      // Test 6: Validate ECDSA public key
      totalTests++
      if (vaultData.publicKeyEcdsa === expected.publicKeys.ecdsa) {
        console.log(`✅ ECDSA key matches: ${vaultData.publicKeyEcdsa}`)
        passedTests++
      } else {
        console.log(`❌ ECDSA key mismatch:`)
        console.log(`   Got:      ${vaultData.publicKeyEcdsa}`)
        console.log(`   Expected: ${expected.publicKeys.ecdsa}`)
      }
      
      // Test 7: Validate EdDSA public key  
      totalTests++
      if (vaultData.publicKeyEddsa === expected.publicKeys.eddsa) {
        console.log(`✅ EdDSA key matches: ${vaultData.publicKeyEddsa}`)
        passedTests++
      } else {
        console.log(`❌ EdDSA key mismatch:`)
        console.log(`   Got:      ${vaultData.publicKeyEddsa}`)
        console.log(`   Expected: ${expected.publicKeys.eddsa}`)
      }
      
      // Test 8: Validate chain code
      totalTests++
      if (vaultData.hexChainCode === expected.hexChainCode) {
        console.log(`✅ Chain code matches: ${vaultData.hexChainCode}`)
        passedTests++
      } else {
        console.log(`❌ Chain code mismatch:`)
        console.log(`   Got:      ${vaultData.hexChainCode}`)
        console.log(`   Expected: ${expected.hexChainCode}`)
      }
      
      // Test 9: Validate library type
      totalTests++
      if (vaultData.libType === expected.libType) {
        console.log(`✅ LibType matches: ${vaultData.libType} (DKLS)`)
        passedTests++
      } else {
        console.log(`❌ LibType mismatch: got ${vaultData.libType}, expected ${expected.libType}`)
      }
      
      // Test 10: Validate local party ID
      totalTests++
      if (vaultData.localPartyId === expected.localPartyId) {
        console.log(`✅ Local Party ID matches: "${vaultData.localPartyId}"`)
        passedTests++
      } else {
        console.log(`❌ Local Party ID mismatch: got "${vaultData.localPartyId}", expected "${expected.localPartyId}"`)
      }
      
      // Test 11: Validate key shares exist
      totalTests++
      if (vaultData.keyShares && vaultData.keyShares.length > 0) {
        console.log(`✅ KeyShares present: ${vaultData.keyShares.length} shares`)
        passedTests++
        
        // Show key share info
        vaultData.keyShares.forEach((ks, i) => {
          console.log(`   Share ${i + 1}: pubkey=${ks.publicKey.substring(0, 20)}..., keyshare=${ks.keyshare.length} bytes`)
        })
      } else {
        console.log('❌ No key shares found')
      }
      
      // Test 12: Validate creation timestamp
      totalTests++
      if (vaultData.createdAt) {
        console.log(`✅ Creation timestamp: ${vaultData.createdAt.toISOString()}`)
        passedTests++
      } else {
        console.log('❌ No creation timestamp found')
      }
      
    } catch (error) {
      console.log(`❌ Test failed with error: ${error instanceof Error ? error.message : error}`)
    }
    
    console.log('')
  }
  
  // Summary
  console.log('📊 Test Summary')
  console.log('================')
  console.log(`Total tests: ${totalTests}`)
  console.log(`Passed: ${passedTests}`)
  console.log(`Failed: ${totalTests - passedTests}`)
  console.log(`Success rate: ${Math.round((passedTests / totalTests) * 100)}%`)
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! VaultLoader is working correctly.')
  } else {
    console.log('⚠️  Some tests failed. Check the output above for details.')
  }
}

// Run the tests
runVaultLoaderTests().catch(console.error)