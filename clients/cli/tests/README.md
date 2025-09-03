# Vultisig CLI Test Suite

Comprehensive test coverage for vault loading, address derivation, and CLI functionality.

## 🚀 Quick Test Run

```bash
# Run all tests
npm test
# or
node tests/run-all-tests.js

# Run individual test suites
node tests/vault-loader.test.js
node tests/address-derivation.test.js  
node tests/cli-integration.test.js
```

## 📋 Test Coverage

### 🔐 VaultLoader Tests (`vault-loader.test.js`)
- **Vault file parsing** - Protobuf container and vault parsing
- **Encryption detection** - Automatic encrypted/unencrypted detection
- **AES-256-GCM decryption** - Password-based vault decryption
- **Vault data validation** - Public keys, signers, chain codes
- **Key share extraction** - MPC key share validation

**Test Cases:**
- ✅ Unencrypted vault (`TestSecureVault-cfa0-share2of2.vult`)
- ✅ Encrypted vault (`TestFastVault-44fd-share2of2-Password123!.vult`)

### 🔗 Address Derivation Tests (`address-derivation.test.js`)
- **Trust Wallet Core integration** - WASM initialization and functionality
- **Multi-chain support** - All 20 blockchain networks  
- **Signature algorithms** - ECDSA (15 chains) and EdDSA (5 chains)
- **Address accuracy** - 100% match against expected addresses
- **Special chain handling** - Cardano, MayaChain, Tron edge cases
- **Bulk derivation** - Multi-chain address generation

**Tested Chains:**
- **ECDSA**: Bitcoin, Ethereum, Litecoin, Dogecoin, THORChain, Cosmos, MayaChain, Ripple, Tron, EVM chains (Avalanche, Polygon, BSC, Optimism, Arbitrum, Base)  
- **EdDSA**: Solana, Cardano, Polkadot, Sui, Ton

### 🖥️ CLI Integration Tests (`cli-integration.test.js`)
- **CLI commands** - Version, help, list, address, status, quit
- **Keyshare discovery** - Auto-detection and listing
- **Password handling** - Encrypted vault authentication
- **Error handling** - Graceful failure modes
- **Output validation** - Success indicators and formatting
- **End-to-end workflows** - Complete user scenarios

**Test Scenarios:**
- ✅ Basic CLI functionality (version, help, list)
- ✅ Unencrypted vault address derivation
- ✅ Encrypted vault with password authentication
- ✅ All chains support validation
- ✅ Error handling (wrong password, missing files)
- ✅ Daemon status checking

## 📊 Expected Results

### Success Criteria
- **100% pass rate** on vault loading tests
- **100% address accuracy** across all chains
- **90%+ CLI integration** test success
- **All test suites complete** without crashes

### Performance Benchmarks
- **Trust Wallet Core init**: < 5 seconds
- **Address derivation**: < 1 second per chain
- **Vault loading**: < 500ms per vault
- **Full test suite**: < 60 seconds

## 🔍 Test Data

### Test Vaults
```
keyshares/
├── TestSecureVault-cfa0-share2of2.vult          # Unencrypted
├── TestFastVault-44fd-share2of2-Password123!.vult # Encrypted
├── keyshare-details-TestSecureVault-cfa0-share2of2-Nopassword.json
└── keyshare-details-TestFastVault-44fd-share2of2.json
```

### Expected Addresses (Samples)
```
TestSecureVault (Unencrypted):
  Bitcoin: bc1qg7gldwlccw9qeyzpew37hetu2ys042wnu2n3l4
  Ethereum: 0x3B47C2D0678F92ECd8f54192D14d541f28DDbE97
  Solana: 5knhKqfmWuf6QJb4kwcUP47K9QpUheaxBbvDpNLVqCZz

TestFastVault (Encrypted):
  Bitcoin: bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9
  Ethereum: 0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c
  Solana: G5Jm9g1NH1xprPz3ZpnNmF8Wkz2F6YUhkxpf432mRefR
```

## 🛠️ Development

### Adding Tests
```javascript
// In your test file
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
```

### Prerequisites
- Built CLI: `npm run build`
- Keyshares directory with test vaults
- Node.js environment

### Debugging Tests
```bash
# Run with more verbose output
VULTISIG_DEBUG=1 node tests/run-all-tests.js

# Test specific functionality
node tests/vault-loader.test.js
node tests/address-derivation.test.js
```

## 📈 Test Results Interpretation

### 🎉 All Tests Pass (100%)
- CLI is production-ready
- All functionality working correctly
- No known issues

### ✅ Most Tests Pass (90%+)
- Core functionality working
- Minor issues may exist
- Safe for most use cases

### ⚠️ Some Tests Pass (70-90%)
- Significant functionality working
- Some known issues
- Requires attention before production

### ❌ Tests Fail (<70%)
- Major issues detected
- Not ready for use
- Requires debugging and fixes

## 🏗️ Continuous Integration

These tests are designed to be run in CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Run Tests
  run: |
    npm run build
    npm test
```

The test suite exits with:
- **Exit code 0**: All tests passed
- **Exit code 1**: Tests failed or errors occurred