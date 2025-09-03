const fs = require('fs');
const path = require('path');

console.log('🧪 Simple VaultLoader Integration Test');
console.log('======================================\n');

// Test the unencrypted vault
const testFile = 'TestSecureVault-cfa0-share2of2-Nopassword.vult';
const filePath = path.join(__dirname, 'keyshares', testFile);

console.log(`📁 Testing: ${testFile}`);

try {
  // Check if file exists  
  if (!fs.existsSync(filePath)) {
    console.log('❌ File not found');
    process.exit(1);
  }
  console.log('✅ File exists');

  // Try to require the VaultLoader (will fail if deps not installed)
  try {
    // This will only work if the modules are properly installed
    const { VaultLoader } = require('../dist/clients/cli-ts/src/vault/VaultLoader.js');
    const loader = new VaultLoader();
    
    // Test basic functionality
    loader.loadVaultFromFile(filePath)
      .then(vault => {
        console.log('✅ VaultLoader successfully parsed vault!');
        console.log('📋 Vault Details:');
        console.log(`   Name: ${vault.name}`);
        console.log(`   Signers: [${vault.signers.join(', ')}]`);
        console.log(`   ECDSA Key: ${vault.publicKeyEcdsa}`);
        console.log(`   EdDSA Key: ${vault.publicKeyEddsa}`);
        console.log(`   Chain Code: ${vault.hexChainCode}`);
        console.log(`   LibType: ${vault.libType}`);
        console.log(`   KeyShares: ${vault.keyShares.length}`);
        
        // Validate against expected values
        const expected = {
          name: 'TestSecureVault',
          signers: ['iPhone-5C9', "jp's MacBook Air-EE5"],
          publicKeyEcdsa: '03165c66e1c84d4d5b761e3061d311f2b4e63009b354e4b18fecb9657a0397cfa0',
          publicKeyEddsa: '46a663e9c21de660f7b103d5cb669be2109a4d6e2171045b7be82423175a4ee5',
          hexChainCode: 'd8eb76b83dca3a7cdcfaee11c40f5702193f6a988ebc1b05215a3a28ec9910b3'
        };
        
        console.log('\\n🔍 Validation Results:');
        console.log(`Name: ${vault.name === expected.name ? '✅' : '❌'} (${vault.name})`);
        console.log(`ECDSA: ${vault.publicKeyEcdsa === expected.publicKeyEcdsa ? '✅' : '❌'}`);
        console.log(`EdDSA: ${vault.publicKeyEddsa === expected.publicKeyEddsa ? '✅' : '❌'}`);
        console.log(`Chain Code: ${vault.hexChainCode === expected.hexChainCode ? '✅' : '❌'}`);
        
        const signersMatch = vault.signers.length === expected.signers.length && 
          vault.signers.every(s => expected.signers.includes(s));
        console.log(`Signers: ${signersMatch ? '✅' : '❌'} (${vault.signers.length} vs ${expected.signers.length})`);
        
      })
      .catch(error => {
        console.log('❌ VaultLoader failed:', error.message);
      });
    
  } catch (importError) {
    console.log('❌ Could not import VaultLoader - modules not compiled or dependencies missing');
    console.log('   Error:', importError.message);
    console.log('\\n💡 To fix this:');
    console.log('   1. npm install');
    console.log('   2. npm run build');
    console.log('   3. Run this test again');
  }

} catch (error) {
  console.log('❌ Test failed:', error.message);
}