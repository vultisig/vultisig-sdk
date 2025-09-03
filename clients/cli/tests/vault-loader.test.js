const fs = require('fs');
const path = require('path');

/**
 * Test Suite: VaultLoader
 * Tests vault loading, encryption detection, and protobuf parsing
 */

console.log('🧪 VaultLoader Test Suite');
console.log('========================\n');

// Expected vault data from keyshare details
const EXPECTED_VAULTS = {
  'TestSecureVault-cfa0-share2of2.vult': {
    name: 'TestSecureVault',
    localPartyId: "jp's MacBook Air-EE5",
    signers: ["iPhone-5C9", "jp's MacBook Air-EE5"],
    libType: 1, // DKLS
    encrypted: false,
    publicKeys: {
      ecdsa: '03165c66e1c84d4d5b761e3061d311f2b4e63009b354e4b18fecb9657a0397cfa0',
      eddsa: '46a663e9c21de660f7b103d5cb669be2109a4d6e2171045b7be82423175a4ee5'
    },
    hexChainCode: 'd8eb76b83dca3a7cdcfaee11c40f5702193f6a988ebc1b05215a3a28ec9910b3'
  },
  'TestFastVault-44fd-share2of2-Password123!.vult': {
    name: 'TestFastVault',
    localPartyId: 'iPhone-5C9',
    signers: ['Server-94060', 'iPhone-5C9'],
    libType: 1, // DKLS
    encrypted: true,
    password: 'Password123!',
    publicKeys: {
      ecdsa: '03ac0f333fc5d22f929e013be80988f57a56837db64d968c126ca4c943984744fd',
      eddsa: 'dff9b5b456eadcbd99366fd691f50f865a26df433f9cbffe1b6f319ecadb8308'
    },
    hexChainCode: 'c39c57cd4127a5c5d6c8583f3f12d7be26e7eed8c398e7ee9926cd33845cae1b'
  }
};

async function runVaultLoaderTests() {
  const { VaultLoader } = require('../dist/clients/cli-ts/src/vault/VaultLoader.js');
  
  const loader = new VaultLoader();
  const keyshareDir = path.join(__dirname, '..', 'keyshares');
  
  let totalTests = 0;
  let passedTests = 0;
  
  function test(name, condition, actualValue = '', expectedValue = '') {
    totalTests++;
    if (condition) {
      console.log(`✅ ${name}`);
      passedTests++;
    } else {
      console.log(`❌ ${name}`);
      if (actualValue && expectedValue) {
        console.log(`   Got:      ${actualValue}`);
        console.log(`   Expected: ${expectedValue}`);
      }
    }
  }
  
  // Test each vault file
  for (const [filename, expected] of Object.entries(EXPECTED_VAULTS)) {
    const filePath = path.join(keyshareDir, filename);
    
    console.log(`📁 Testing: ${filename}`);
    console.log('─'.repeat(60));
    
    try {
      // Test file existence
      test('File exists', fs.existsSync(filePath));
      
      // Test encryption detection
      const isUnencrypted = await loader.checkIfUnencrypted(filePath);
      test('Encryption detection', isUnencrypted === !expected.encrypted, isUnencrypted, !expected.encrypted);
      
      // Test vault loading
      let vault;
      if (expected.encrypted) {
        vault = await loader.loadVaultFromFile(filePath, expected.password);
      } else {
        vault = await loader.loadVaultFromFile(filePath);
      }
      
      test('Vault loaded successfully', !!vault);
      
      if (vault) {
        // Test vault properties
        test('Vault name', vault.name === expected.name, vault.name, expected.name);
        test('Local Party ID', vault.localPartyId === expected.localPartyId, vault.localPartyId, expected.localPartyId);
        test('Library type', vault.libType === expected.libType, vault.libType, expected.libType);
        
        // Test signers array
        const signersMatch = vault.signers.length === expected.signers.length &&
                           vault.signers.every(s => expected.signers.includes(s));
        test('Signers match', signersMatch, vault.signers.join(','), expected.signers.join(','));
        
        // Test public keys
        test('ECDSA public key', vault.publicKeyEcdsa === expected.publicKeys.ecdsa, 
             vault.publicKeyEcdsa, expected.publicKeys.ecdsa);
        test('EdDSA public key', vault.publicKeyEddsa === expected.publicKeys.eddsa,
             vault.publicKeyEddsa, expected.publicKeys.eddsa);
        test('Chain code', vault.hexChainCode === expected.hexChainCode,
             vault.hexChainCode, expected.hexChainCode);
        
        // Test key shares exist
        test('Key shares present', Array.isArray(vault.keyShares) && vault.keyShares.length > 0);
        
        console.log(`   📊 Key shares: ${vault.keyShares.length}`);
      }
      
    } catch (error) {
      console.log(`❌ Test failed: ${error.message}`);
    }
    
    console.log('');
  }
  
  // Summary
  console.log('📊 VaultLoader Test Results');
  console.log('===========================');
  console.log(`Total tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`Success rate: ${Math.round((passedTests / totalTests) * 100)}%`);
  
  return { totalTests, passedTests };
}

// Export for use in other test files
module.exports = { runVaultLoaderTests, EXPECTED_VAULTS };

// Run tests if called directly
if (require.main === module) {
  runVaultLoaderTests().catch(console.error);
}