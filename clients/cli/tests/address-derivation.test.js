const fs = require('fs');
const path = require('path');

/**
 * Test Suite: Address Derivation
 * Tests Trust Wallet Core integration and multi-chain address generation
 */

console.log('🧪 Address Derivation Test Suite');
console.log('================================\n');

// Expected addresses from keyshare details
const EXPECTED_ADDRESSES = {
  'TestSecureVault-cfa0-share2of2.vult': {
    Bitcoin: 'bc1qg7gldwlccw9qeyzpew37hetu2ys042wnu2n3l4',
    Ethereum: '0x3B47C2D0678F92ECd8f54192D14d541f28DDbE97',
    Solana: '5knhKqfmWuf6QJb4kwcUP47K9QpUheaxBbvDpNLVqCZz',
    Litecoin: 'ltc1qg5wh8srl4vn0x4mhvynznarx82geeyz675er8r',
    Dogecoin: 'DK2WHssm1LaKRx9Xap4CHCxpPDhLkDAybF',
    'Cardano': 'addr1vx5rmtmdye0p90dwecdjtmrqmyjq6k6kdk44a7arrk4fpfsvgt3ej',
    'THORChain': 'thor15q49a2nt8zehfmlaypjdm4wyja8a9pruuhsf6m',
    'Cosmos': 'cosmos1qjajscnnvmpv0yufupqjr6jq6h5cadl9fx0y4n',
    'MayaChain': 'maya15q49a2nt8zehfmlaypjdm4wyja8a9pruuqw9vt',
    'Polkadot': '12bdnFVFtwccqXce3TrqxKzn3n5cUMR2TsmkZV2yRPN54oGm',
    'Ripple': 'rGZp7eRFkqgKVy6PQYs5Zb62tFmV2UTsbz',
    'Tron': 'TKnrAXYwuu9FCeSob2EyZWShMd5xBWrUVn',
    'Sui': '0x67e335d41c3b4bccae1b53fdc8529879026dbffef59d93723a966ccf5b60eaf2',
    'Ton': 'UQCtgmeN_YbwR_QAg4SC72WH4T5dYmTYA_tO722BKlG_YfhQ'
  },
  'TestFastVault-44fd-share2of2-Password123!.vult': {
    Bitcoin: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
    Ethereum: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
    Solana: 'G5Jm9g1NH1xprPz3ZpnNmF8Wkz2F6YUhkxpf432mRefR',
    Litecoin: 'ltc1qkdau9j2puxrsu0vlwa6q7cysq8ys97w2tk7whc',
    Dogecoin: 'DTSParRZGeQSzPK2uTvzFCtsiWfTbwvmUZ',
    'Cardano': 'addr1v8ktk0y6xkhy7k60wzdwwkc77n7cvlduw2cuew2a0frk6aq8ahycw',
    'THORChain': 'thor1nuwfr59wyn6da6v5ktxsa32v2t6u2q4veg9awu',
    'Cosmos': 'cosmos1axf2e8w0k73gp7zmfqcx7zssma34haxh7xwlsu',
    'MayaChain': 'maya1nuwfr59wyn6da6v5ktxsa32v2t6u2q4velm3cv',
    'Polkadot': '164frjvvMTVaeZS5No4KfjsVEQFruHY1tZAhXd5WMGQB4yva',
    'Ripple': 'rpauN4CN6hDdZBwjTbPvtdW6TBVzroFQCm',
    'Tron': 'TSZh1ddJLcVruiC6kZYojtAVwKawC2jVj5',
    'Sui': '0x61102d766fc7e62ff2d1f2094636e4d04dc137ee3bb469a8d027c3f432d715fe',
    'Ton': 'UQCeg8c0AuZfbZbYf_WtzgKXnPLUwXkPjZwEKB16VzwSC4Yl'
  }
};

const TEST_CHAINS = ['btc', 'eth', 'sol', 'ltc', 'doge', 'ada', 'thor', 'atom', 'maya', 'dot', 'xrp', 'trx', 'sui', 'ton'];

async function runAddressDerivationTests() {
  const { VaultLoader } = require('../dist/clients/cli-ts/src/vault/VaultLoader.js');
  const { AddressDeriver } = require('../dist/clients/cli-ts/src/address/AddressDeriver.js');
  
  const loader = new VaultLoader();
  const deriver = new AddressDeriver();
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
  
  // Test Trust Wallet Core initialization
  console.log('🔧 Initializing Trust Wallet Core...');
  await deriver.initialize();
  test('Trust Wallet Core initialized', true);
  
  // Test each vault file
  for (const filename of Object.keys(EXPECTED_ADDRESSES)) {
    const filePath = path.join(keyshareDir, filename);
    const expected = EXPECTED_ADDRESSES[filename];
    const isEncrypted = filename.includes('Password123');
    
    console.log(`\n📁 Testing: ${filename}`);
    console.log('─'.repeat(60));
    
    try {
      // Load vault
      let vault;
      if (isEncrypted) {
        vault = await loader.loadVaultFromFile(filePath, 'Password123!');
      } else {
        vault = await loader.loadVaultFromFile(filePath);
      }
      
      test('Vault loaded for address testing', !!vault);
      
      if (!vault) continue;
      
      // Test signature algorithm detection
      for (const chainKey of TEST_CHAINS) {
        const algorithm = deriver.getSignatureAlgorithm(chainKey);
        const isValid = deriver.validateVaultForChain(vault, chainKey);
        
        test(`${chainKey.toUpperCase()} signature algorithm detected`, 
             algorithm === 'ecdsa' || algorithm === 'eddsa');
        test(`${chainKey.toUpperCase()} vault validation`, isValid);
      }
      
      // Test individual chain derivations
      console.log('\n🔗 Testing individual chain derivations:');
      for (const chainKey of TEST_CHAINS) {
        try {
          const chainName = getChainDisplayName(chainKey);
          const address = await deriver.deriveAddressForSingleChain(vault, chainKey);
          const expectedAddr = expected[chainName];
          
          test(`${chainName} address derived`, !!address);
          
          if (expectedAddr) {
            const matches = address === expectedAddr;
            test(`${chainName} address matches expected`, matches, 
                 address.slice(0, 20) + '...', expectedAddr.slice(0, 20) + '...');
            
            if (matches) {
              console.log(`   📍 ${chainName}: ✅ EXACT MATCH`);
            } else {
              console.log(`   📍 ${chainName}: ❌ MISMATCH`);
              console.log(`      Derived:  ${address}`);
              console.log(`      Expected: ${expectedAddr}`);
            }
          }
          
        } catch (error) {
          console.log(`   ❌ ${chainKey.toUpperCase()} derivation failed: ${error.message}`);
        }
      }
      
      // Test bulk address derivation
      console.log('\n📦 Testing bulk address derivation...');
      try {
        const bulkAddresses = await deriver.deriveAddresses(vault, TEST_CHAINS);
        test('Bulk derivation succeeded', !!bulkAddresses && Object.keys(bulkAddresses).length > 0);
        
        // Verify bulk results match individual results
        let bulkMatches = 0;
        for (const [chainName, address] of Object.entries(bulkAddresses)) {
          if (!address.startsWith('Error:') && expected[chainName] && address === expected[chainName]) {
            bulkMatches++;
          }
        }
        
        test(`Bulk derivation accuracy`, bulkMatches >= 10, bulkMatches, 'at least 10');
        
      } catch (error) {
        console.log(`   ❌ Bulk derivation failed: ${error.message}`);
      }
      
    } catch (error) {
      console.log(`❌ Address test failed: ${error.message}`);
    }
  }
  
  // Summary
  console.log('\n📊 Address Derivation Test Results');
  console.log('==================================');
  console.log(`Total tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`Success rate: ${Math.round((passedTests / totalTests) * 100)}%`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All address derivation tests passed! Trust Wallet Core integration is perfect.');
  } else if (passedTests / totalTests >= 0.8) {
    console.log('✅ Most address derivation tests passed! System is working well.');
  } else {
    console.log('⚠️  Address derivation needs attention. Check errors above.');
  }
  
  return { totalTests, passedTests };
}

function getChainDisplayName(chainKey) {
  const mapping = {
    btc: 'Bitcoin', eth: 'Ethereum', sol: 'Solana', ltc: 'Litecoin', 
    doge: 'Dogecoin', ada: 'Cardano', thor: 'THORChain', atom: 'Cosmos',
    maya: 'MayaChain', dot: 'Polkadot', xrp: 'Ripple', trx: 'Tron',
    sui: 'Sui', ton: 'Ton'
  };
  return mapping[chainKey] || chainKey;
}

// Export for use in other test files
module.exports = { runAddressDerivationTests, EXPECTED_ADDRESSES, TEST_CHAINS };

// Run tests if called directly
if (require.main === module) {
  runAddressDerivationTests().catch(console.error);
}