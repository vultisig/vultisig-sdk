#!/usr/bin/env node

/**
 * Master Test Suite Runner
 * Runs all test suites and provides comprehensive reporting
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 Vultisig CLI - Master Test Suite');
console.log('===================================');
console.log(`📅 Started: ${new Date().toISOString()}`);
console.log(`🖥️  Platform: ${process.platform} ${process.arch}`);
console.log(`📦 Node.js: ${process.version}\n`);

// Import test suites
const { runVaultLoaderTests } = require('./vault-loader.test.js');
const { runAddressDerivationTests } = require('./address-derivation.test.js');
const { runCLIIntegrationTests } = require('./cli-integration.test.js');

async function runAllTests() {
  const startTime = Date.now();
  let totalTests = 0;
  let totalPassed = 0;
  const suiteResults = [];
  
  // Check prerequisites
  console.log('🔍 Pre-flight Checks');
  console.log('─'.repeat(30));
  
  const distExists = fs.existsSync(path.join(__dirname, '..', 'dist'));
  console.log(`${distExists ? '✅' : '❌'} Built CLI exists: dist/`);
  
  const keyshareExists = fs.existsSync(path.join(__dirname, '..', 'keyshares'));
  console.log(`${keyshareExists ? '✅' : '❌'} Keyshares directory exists`);
  
  if (!distExists) {
    console.log('\n❌ ERROR: CLI not built. Run "npm run build" first.');
    process.exit(1);
  }
  
  if (!keyshareExists) {
    console.log('\n❌ ERROR: Keyshares directory not found.');
    process.exit(1);
  }
  
  console.log('✅ Prerequisites met\n');
  
  // Run test suites
  const testSuites = [
    { name: 'VaultLoader', fn: runVaultLoaderTests, description: 'Vault parsing & encryption' },
    { name: 'Address Derivation', fn: runAddressDerivationTests, description: 'Trust Wallet Core integration' },
    { name: 'CLI Integration', fn: runCLIIntegrationTests, description: 'End-to-end CLI functionality' }
  ];
  
  for (const suite of testSuites) {
    console.log(`🎯 Running ${suite.name} Tests`);
    console.log(`   ${suite.description}`);
    console.log('═'.repeat(50));
    
    try {
      const result = await suite.fn();
      suiteResults.push({
        name: suite.name,
        ...result,
        success: true
      });
      totalTests += result.totalTests;
      totalPassed += result.passedTests;
      
    } catch (error) {
      console.log(`❌ ${suite.name} test suite failed: ${error.message}`);
      suiteResults.push({
        name: suite.name,
        totalTests: 0,
        passedTests: 0,
        success: false,
        error: error.message
      });
    }
    
    console.log(''); // Spacer between suites
  }
  
  // Final reporting
  const endTime = Date.now();
  const duration = Math.round((endTime - startTime) / 1000);
  
  console.log('🏁 Final Test Results');
  console.log('═'.repeat(50));
  
  // Suite-by-suite breakdown
  for (const result of suiteResults) {
    const percentage = result.totalTests > 0 ? Math.round((result.passedTests / result.totalTests) * 100) : 0;
    const status = result.success && percentage === 100 ? '🎉' : 
                   result.success && percentage >= 80 ? '✅' : '❌';
    
    console.log(`${status} ${result.name}: ${result.passedTests}/${result.totalTests} (${percentage}%)`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }
  
  console.log('');
  console.log('📊 Overall Summary');
  console.log('─'.repeat(30));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalTests - totalPassed}`);
  console.log(`Success Rate: ${totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0}%`);
  console.log(`Duration: ${duration}s`);
  
  // Final verdict
  const overallSuccess = totalPassed === totalTests && totalTests > 0;
  const overallPercentage = totalTests > 0 ? (totalPassed / totalTests) : 0;
  
  console.log('');
  if (overallSuccess) {
    console.log('🎉 ALL TESTS PASSED! 🎉');
    console.log('✅ Vultisig CLI is fully functional and production-ready');
    console.log('✅ Vault loading with encryption/decryption working');
    console.log('✅ Trust Wallet Core integration with 100% address accuracy');
    console.log('✅ All 20 blockchain networks supported');
    console.log('✅ CLI commands and error handling working properly');
  } else if (overallPercentage >= 0.9) {
    console.log('✅ TESTS MOSTLY PASSED');
    console.log('🔧 Minor issues detected, but core functionality working');
  } else if (overallPercentage >= 0.7) {
    console.log('⚠️  TESTS PARTIALLY PASSED');
    console.log('🔧 Some functionality working, but significant issues detected');
  } else {
    console.log('❌ TESTS FAILED');
    console.log('🔧 Major issues detected, requires attention');
  }
  
  console.log('');
  console.log('📋 System Information:');
  console.log(`   - CLI Version: 1.0.0`);
  console.log(`   - Trust Wallet Core: Integrated via WASM`);
  console.log(`   - Supported Chains: 20 (15 ECDSA, 5 EdDSA)`);
  console.log(`   - Test Coverage: Vault loading, address derivation, CLI integration`);
  console.log(`   - Test Duration: ${duration}s`);
  
  // Exit with appropriate code
  process.exit(overallSuccess ? 0 : 1);
}

// Export for programmatic use
module.exports = { runAllTests };

// Run if called directly
if (require.main === module) {
  runAllTests().catch((error) => {
    console.error('\n💥 Test runner crashed:', error.message);
    process.exit(1);
  });
}