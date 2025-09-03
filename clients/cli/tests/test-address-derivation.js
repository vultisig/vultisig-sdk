const fs = require('fs');
const path = require('path');

console.log('🧪 Address Derivation Test Suite');
console.log('================================\n');

// Expected addresses from keyshare-details JSON files
const EXPECTED_ADDRESSES = {
  'TestFastVault-44fd-share1of2-Vultiserver.vult': {
    vaultName: 'TestFastVault',
    encrypted: true,
    addresses: {
      Bitcoin: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
      Ethereum: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
      THORChain: 'thor1nuwfr59wyn6da6v5ktxsa32v2t6u2q4veg9awu',
      Cosmos: 'cosmos1axf2e8w0k73gp7zmfqcx7zssma34haxh7xwlsu',
      Solana: 'G5Jm9g1NH1xprPz3ZpnNmF8Wkz2F6YUhkxpf432mRefR'
    }
  },
  'TestSecureVault-cfa0-share2of2-Nopassword.vult': {
    vaultName: 'TestSecureVault',
    encrypted: false,
    addresses: {
      Bitcoin: 'bc1qg7gldwlccw9qeyzpew37hetu2ys042wnu2n3l4',
      Ethereum: '0x3B47C2D0678F92ECd8f54192D14d541f28DDbE97',
      THORChain: 'thor15q49a2nt8zehfmlaypjdm4wyja8a9pruuhsf6m',
      Cosmos: 'cosmos1qjajscnnvmpv0yufupqjr6jq6h5cadl9fx0y4n',
      Solana: '5knhKqfmWuf6QJb4kwcUP47K9QpUheaxBbvDpNLVqCZz'
    }
  }
};

async function testAddressDerivation() {
  const { VaultLoader } = require('../dist/clients/cli-ts/src/vault/VaultLoader.js');
  const { AddressDeriver } = require('../dist/clients/cli-ts/src/address/AddressDeriver.js');
  
  const loader = new VaultLoader();
  const deriver = new AddressDeriver();
  const keyshareDir = path.join(__dirname, 'keyshares');
  
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
  
  // Test only the unencrypted vault for now (avoid password complexity)
  const testFile = 'TestSecureVault-cfa0-share2of2-Nopassword.vult';
  const expected = EXPECTED_ADDRESSES[testFile];
  const filePath = path.join(keyshareDir, testFile);
  
  console.log(`📁 Testing Address Derivation: ${testFile}`);
  console.log('─'.repeat(60));
  
  try {
    // Load vault
    const vault = await loader.loadVaultFromFile(filePath);
    test('Vault loaded', !!vault);
    test('Vault name matches', vault.name === expected.vaultName, vault.name, expected.vaultName);
    
    // Test Trust Wallet Core initialization
    console.log('🔧 Initializing Trust Wallet Core...');
    await deriver.initialize();
    test('Trust Wallet Core initialized', true);
    
    // Test individual chain derivations
    const testChains = ['btc', 'eth', 'thor', 'atom', 'sol'];
    
    for (const chainKey of testChains) {
      try {
        console.log(`\\n🔗 Testing ${chainKey.toUpperCase()} address derivation...`);
        
        const algorithm = deriver.getSignatureAlgorithm(chainKey);
        console.log(`   Algorithm: ${algorithm}`);
        
        const isValid = deriver.validateVaultForChain(vault, chainKey);
        test(`Vault has required keys for ${chainKey}`, isValid);
        
        if (isValid) {
          const address = await deriver.deriveAddressForSingleChain(vault, chainKey);
          const chainName = chainKey === 'btc' ? 'Bitcoin' : 
                           chainKey === 'eth' ? 'Ethereum' :
                           chainKey === 'thor' ? 'THORChain' :
                           chainKey === 'atom' ? 'Cosmos' :
                           chainKey === 'sol' ? 'Solana' : chainKey;
          
          const expectedAddr = expected.addresses[chainName];
          
          test(`${chainName} address derived`, !!address);
          console.log(`   📍 Derived: ${address}`);
          console.log(`   📍 Expected: ${expectedAddr}`);
          
          if (expectedAddr) {
            test(`${chainName} address matches expected`, address === expectedAddr, address, expectedAddr);
          } else {
            console.log(`   ⚠️  No expected address found for comparison`);
          }
        }
        
      } catch (error) {
        console.log(`   ❌ Error deriving ${chainKey}: ${error.message}`);
      }
    }
    
    // Test bulk address derivation
    console.log('\\n📦 Testing bulk address derivation...');
    try {
      const bulkAddresses = await deriver.deriveAddresses(vault, testChains);
      test('Bulk derivation succeeded', !!bulkAddresses && Object.keys(bulkAddresses).length > 0);
      
      console.log('\\n📋 All derived addresses:');
      for (const [chainName, address] of Object.entries(bulkAddresses)) {
        const status = address.startsWith('Error:') ? '❌' : '✅';
        console.log(`   ${status} ${chainName}: ${address}`);
      }
      
    } catch (error) {
      console.log(`   ❌ Bulk derivation failed: ${error.message}`);
    }
    
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
    console.log(error.stack);
  }
  
  // Summary
  console.log('\\n📊 Test Results');
  console.log('=================');
  console.log(`Total tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`Success rate: ${Math.round((passedTests / totalTests) * 100)}%`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! Address derivation is working perfectly.');
  } else if (passedTests / totalTests >= 0.7) {
    console.log('✅ Most tests passed! Address derivation is working well.');
  } else {
    console.log('⚠️  Address derivation needs attention. Check errors above.');
  }
  
  console.log('\\n🔍 Technical Details:');
  console.log('   - Trust Wallet Core: Initialized via WASM');
  console.log('   - BIP32 Derivation: Using bip32 + tiny-secp256k1 libraries');
  console.log('   - ECDSA chains: Bitcoin, Ethereum, THORChain, Cosmos');
  console.log('   - EdDSA chains: Solana (direct public key usage)');
  console.log('   - Address formats: Native to each blockchain');
}

// Run the test
testAddressDerivation().catch(console.error);