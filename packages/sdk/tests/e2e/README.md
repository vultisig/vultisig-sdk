# E2E Tests - Vultisig SDK

End-to-end tests for the Vultisig SDK using a persistent fast vault to test production operations without broadcasting transactions.

## Overview

These E2E tests validate the SDK against **production blockchain RPCs** using a **pre-created persistent fast vault**. All tests are **read-only** - no transactions are broadcast to any blockchain.

## Test Strategy

### Persistent Vault Approach

Instead of creating new vaults for every test run (which requires email verification and MPC keygen overhead), we use a **pre-created test vault** that is reused across all test runs:

- **Vault**: TestFastVault-44fd
- **Type**: Fast (2-of-2 MPC with VultiServer)
- **Password**: `Password123!`
- **Location**: `tests/fixtures/vaults/TestFastVault-44fd-share2of2-Password123!.vult`

### Benefits

✅ **Fast** - No vault creation overhead (save 30+ seconds per run)
✅ **No email verification** - Pre-created vault is already verified
✅ **Consistent** - Same vault data across all test runs
✅ **Production-ready** - Tests real RPC endpoints
✅ **Safe** - Read-only operations, no fund transfers

## Test Suites

### 1. Balance Operations (`balance-operations.test.ts`)
- Fetch native token balances (BTC, ETH, SOL, etc.)
- Fetch ERC-20 token balances (USDC, USDT)
- Multi-chain balance fetching in parallel
- Balance caching verification (5-min TTL)
- Address derivation validation

### 2. Gas Estimation (`gas-estimation.test.ts`)
- EVM gas estimation (EIP-1559 for ETH, BSC, Polygon, etc.)
- UTXO fee estimation (Bitcoin, Litecoin, Dogecoin)
- L2 gas estimation (Arbitrum, Optimism, Base)
- Other chain fees (Solana, Cosmos, THORChain)
- Gas comparison across chains

### 3. Transaction Preparation (`tx-preparation.test.ts`)
- Prepare ETH transfers (no broadcast)
- Prepare ERC-20 transfers (no broadcast)
- Prepare Bitcoin transfers (no broadcast)
- Multi-chain transaction preparation
- Transactions with memo/data (THORChain swaps, Cosmos)
- Custom fee settings
- Payload validation
- **Safety verification**: Confirms NO transactions were broadcast

### 4. Multi-Chain Coverage (`multi-chain-coverage.test.ts`)
- Comprehensive balance fetching for 12+ chains
- Address derivation for all chains
- Gas estimation coverage
- Batch operations performance
- Chain family validation (Bitcoin, EVM, Cosmos, Solana)
- Production API integration

## Running Tests

### Run All E2E Tests
```bash
npm run test:e2e
# or
yarn test:e2e
```

### Run Specific Test Suite
```bash
npm run test:e2e -- balance-operations
npm run test:e2e -- gas-estimation
npm run test:e2e -- tx-preparation
npm run test:e2e -- multi-chain
```

### Run with Coverage
```bash
npm run test:e2e:coverage
```

### Run in Watch Mode
```bash
npm run test:e2e -- --watch
```

## Expected Results

- **650+ tests** passing (including unit & integration)
- **~50 E2E tests** (new)
- **Execution time**: 2-5 minutes for full E2E suite
- **Success rate**: ≥80% for multi-chain tests (some chains may have RPC issues)

## Safety Guarantees

### Read-Only Operations
All E2E tests perform **read-only operations only**:
- ✅ Balance queries (RPC calls)
- ✅ Gas estimation (RPC calls)
- ✅ Address derivation (local cryptography)
- ✅ Transaction preparation (builds payload, no broadcast)

### No Transaction Broadcasting
- ❌ NO `vault.sign()` calls
- ❌ NO transaction broadcasting to blockchain
- ❌ NO fund transfers
- ❌ NO state changes on blockchain

### Production Environment
- Uses production VultiServer API: `https://api.vultisig.com`
- Uses production blockchain RPCs (mainnet)
- Tests real-world behavior
- **Safe**: All operations are read-only

## Test Vault Details

```typescript
{
  name: 'TestFastVault',
  type: 'fast',
  publicKeys: {
    ecdsa: '03ac0f333fc5d22f929e013be80988f57a56837db64d968c126ca4c943984744fd',
    eddsa: 'dff9b5b456eadcbd99366fd691f50f865a26df433f9cbffe1b6f319ecadb8308'
  },
  addresses: {
    Bitcoin: 'bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9',
    Ethereum: '0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c',
    Solana: 'G5Jm9g1NH1xprPz3ZpnNmF8Wkz2F6YUhkxpf432mRefR',
    // ... 20+ more chains
  }
}
```

## Troubleshooting

### Vault Loading Errors
If you see "Cannot read vault file":
```bash
# Verify vault file exists
ls -la packages/sdk/tests/fixtures/vaults/

# If missing, copy from CLI vaults
cp clients/cli/vaults/TestFastVault-44fd-share2of2-Password123!.vult \
   packages/sdk/tests/fixtures/vaults/
```

### RPC Timeout Errors
Some chains may experience RPC timeouts due to:
- Rate limiting
- Network congestion
- RPC provider issues

This is expected - the multi-chain test requires ≥80% success rate, not 100%.

### Balance is Zero
Some test vault addresses may have zero balance. This is normal - we're testing the **balance fetching mechanism**, not requiring funded addresses.

## Maintenance

### Vault Refresh
If the test vault needs to be refreshed (e.g., new chains added):
```bash
# Use CLI to create new test vault
cd clients/cli
npm run create-vault

# Export vault with test password
# Copy to SDK test fixtures
```

### Adding New Chains
To add a new chain to the test suite:
1. Add chain name to `TEST_VAULT_CONFIG.testChains` in `tests/helpers/test-vault.ts`
2. Run tests - address will be derived automatically
3. (Optional) Add expected address to `TEST_VAULT_CONFIG.addresses`

## Contributing

When adding new E2E tests:
1. Use `loadTestVault()` helper to import the persistent vault
2. Use `verifyTestVault()` to confirm vault loaded correctly
3. Only perform read-only operations (balance, gas, prepareSendTx)
4. Never call `vault.sign()` or broadcast transactions
5. Add appropriate console logs for test progress
6. Include error handling for graceful degradation

## Architecture

```
tests/e2e/
├── README.md                      # This file
├── vitest.config.ts               # E2E test configuration
├── balance-operations.test.ts     # Balance fetching tests
├── gas-estimation.test.ts         # Gas/fee estimation tests
├── tx-preparation.test.ts         # Transaction prep tests (no broadcast)
└── multi-chain-coverage.test.ts   # Comprehensive chain coverage

tests/helpers/
└── test-vault.ts                  # Persistent vault helper

tests/fixtures/vaults/
└── TestFastVault-44fd-share2of2-Password123!.vult  # Pre-created test vault
```

## Next Steps

After E2E read-only tests pass:
1. ✅ Phase 4.1 Complete: Read-only operations validated
2. 🔜 Phase 4.2: Transaction signing with small amounts
3. 🔜 Phase 4.3: Transaction broadcasting (requires funding)

For Phase 4.2+, refer to `docs/plans/testing/PHASE_4_E2E.md` for the full production testing plan with real funds.
