# Integration Tests

This directory contains integration tests for the Vultisig SDK that exercise real blockchain functionality on mainnets with small amounts of real funds.

## Overview

Integration tests verify end-to-end functionality including:
- Vault creation and management
- Address derivation
- Balance fetching
- Transaction signing and broadcasting
- Chain-specific operations (swaps, token transfers, etc.)

**Currently Implemented:**
- ✅ Solana: Native SOL transfers, balance queries, address validation
- 🚧 Solana: SPL token transfers (stubbed)
- 🚧 Solana: Jupiter V6 swaps (stubbed)
- 🚧 Solana: Raydium swaps (stubbed)

**Future Chains:**
- Ethereum, Bitcoin, Avalanche, Polygon, BSC, Cosmos, etc. (35+ total)

## Prerequisites

1. **Node.js 18+** and **Yarn**
2. **A test vault** with funded addresses
3. **Environment variables** configured

## Initial Setup

### Step 1: Create Test Vault

You have two options:

#### Option A: Create a New Test Vault (Recommended)

Run the vault creation script:

```bash
cd tests/integration
node -e "require('./utils/vault-loader').createTestVault('integration-test-vault', 'your-secure-password')"
```

This will:
1. Create a new fast vault
2. Display addresses for all chains
3. Encrypt and save the vault to `config/test-vault.json.enc`

**Important:** The encrypted vault file should NOT be committed to the repository. It's included in `.gitignore`.

#### Option B: Use an Existing Vault

1. Export your vault from the Vultisig app as JSON
2. Encrypt it using the provided utility:

```bash
node -e "
  const fs = require('fs');
  const { encryptVault, saveEncryptedVault } = require('./utils/vault-loader');
  const vaultJson = fs.readFileSync('path/to/your/vault.json', 'utf8');
  saveEncryptedVault(vaultJson, 'your-password');
"
```

### Step 2: Fund Test Addresses

Fund the test vault's addresses with small amounts of cryptocurrency:

**Minimum Recommended Amounts:**
- Solana: $2-5 worth of SOL (~0.015-0.035 SOL)
  - Test transfers: $0.50 per test
  - Gas fees: ~$0.01-0.10 per transaction
- Ethereum: $5-10 worth of ETH (for gas fees)
- Bitcoin: $2-5 worth of BTC
- Other chains: Similar small amounts

**Where to Send Funds:**

After creating the vault, the script will display addresses. Example:

```
Solana: 7xK8zP3z...abc123
Ethereum: 0x1234...5678
Bitcoin: bc1q...xyz
```

Send test funds to these addresses using:
- Centralized exchanges (Coinbase, Binance, etc.)
- Other wallets
- Faucets (for testnets, though these tests use mainnet)

### Step 3: Configure Environment Variables

1. Copy the example environment file:

```bash
cp config/.env.example config/.env
```

2. Edit `config/.env` and set your values:

```bash
# REQUIRED
VAULT_PASSWORD=your-secure-password-here

# OPTIONAL: Test execution
DRY_RUN=false  # Set to true to test without broadcasting

# OPTIONAL: Chain-specific
TEST_RECIPIENT_SOL=   # Leave empty for self-transfer
SOLANA_RPC_ENDPOINT=https://api.mainnet-beta.solana.com
SOLANA_PRIORITY_FEE=5000
```

**Important:** Never commit your `.env` file to version control!

### Step 4: Verify Setup

Run a dry-run to verify everything is configured correctly:

```bash
yarn test:integration:dry
```

This will:
- Load your encrypted vault
- Check balances
- Build transactions
- Log transaction details
- **NOT broadcast** anything

## Running Tests

### Run All Integration Tests

```bash
yarn test:integration
```

This will execute all integration tests and broadcast transactions to mainnet. **Make sure you understand the costs involved!**

### Run in Dry-Run Mode (Recommended for Testing)

```bash
yarn test:integration:dry
```

Or set the environment variable manually:

```bash
DRY_RUN=true yarn test:integration
```

Dry-run mode will:
- ✅ Load vault and check balances
- ✅ Build transactions
- ✅ Sign transactions
- ❌ NOT broadcast to blockchain
- ✅ Log transaction details and payloads

### Run Specific Chain Tests

```bash
# Solana only
yarn test:integration -- solana

# Run specific test file
yarn test:integration -- chains/solana/solana.test.ts
```

### Run with Verbose Output

```bash
yarn test:integration -- --reporter=verbose
```

## Test Configuration

### Test Amounts

Default test amount: **$0.50 USD** per transaction

This is configured in [config/test-config.ts](./config/test-config.ts):

```typescript
chains: {
  solana: {
    testAmountUsd: 0.5,  // $0.50 per test
    // ...
  }
}
```

### Price Feeds

Mock prices are defined in `config/test-config.ts`. Update these periodically:

```typescript
export const MOCK_PRICES = {
  SOL: 140,    // $140 per SOL
  ETH: 2500,   // $2500 per ETH
  BTC: 45000,  // etc.
}
```

For production use, consider fetching real-time prices from CoinGecko or similar APIs.

### RPC Endpoints

Default endpoints are public and may be rate-limited. For better performance, use your own:

```bash
# In .env
SOLANA_RPC_ENDPOINT=https://your-private-rpc-endpoint.com
ETHEREUM_RPC_ENDPOINT=https://mainnet.infura.io/v3/YOUR-KEY
```

## Understanding Test Results

### Successful Test (Dry-Run)

```
================================================================================
⚠ [DRY-RUN] Solana - Native SOL Transfer
================================================================================
From:     7xK8zP3z...abc123
To:       9yT4mN1x...def456
Amount:   0.003571 SOL
ℹ️  DRY-RUN MODE: Transaction signed but NOT broadcasted
================================================================================
```

### Successful Test (Live)

```
================================================================================
✓ [LIVE] Solana - Native SOL Transfer
================================================================================
From:     7xK8zP3z...abc123
To:       9yT4mN1x...def456
Amount:   0.003571 SOL
Tx Hash:  5xK9mP4zQrs...xyz789
Explorer: https://solscan.io/tx/5xK9mP4zQrs...xyz789
================================================================================
```

### Test Summary

At the end of the test run:

```
================================================================================
INTEGRATION TEST SUMMARY
================================================================================
Total Transactions: 5
  Successful:       5
  Failed:           0
  Dry-Run:          5
  Live:             0
================================================================================
```

## Adding New Chain Tests

To add integration tests for a new chain:

1. Create chain directory:

```bash
mkdir -p chains/[chain-name]
```

2. Create fixtures file:

```typescript
// chains/[chain-name]/fixtures.ts
export const CHAIN_PROGRAMS = {
  // Chain-specific constants
};

export const TEST_TOKENS = {
  // Well-known token addresses
};
```

3. Create test file:

```typescript
// chains/[chain-name]/[chain-name].test.ts
import { describe, test, beforeAll } from 'vitest';
// ... implement tests following Solana pattern
```

4. Update `config/test-config.ts`:

```typescript
chains: {
  // ... existing chains
  [chainName]: {
    rpcEndpoint: 'https://...',
    testAmountUsd: 0.5,
    recipientAddress: '',
    explorerTxUrl: (hash: string) => `https://.../${hash}`,
  },
}
```

5. Add environment variables to `.env.example`

## Security Considerations

⚠️ **Important Security Notes:**

1. **Never commit unencrypted vaults or private keys**
   - Vault files are encrypted with AES-256-GCM
   - Password is stored in `.env` (gitignored)

2. **Use dedicated test vaults only**
   - Don't use vaults with significant funds
   - Keep test amounts minimal ($0.50-1.00 per test)

3. **Environment variables**
   - Never commit `.env` files
   - Use strong passwords for vault encryption
   - Rotate passwords periodically

4. **CI/CD Considerations**
   - These tests are **manual-run only**
   - Do NOT run automatically in CI/CD
   - If adding to CI in future:
     - Use GitHub Secrets for vault password
     - Use dedicated CI vault with minimal funds
     - Enable dry-run mode by default

5. **Network Safety**
   - Tests use mainnet (real funds)
   - Always test with dry-run first
   - Monitor transaction fees
   - Set reasonable gas/priority fee limits

## Troubleshooting

### Error: "Vault file not found"

```
Error: Vault file not found at .../test-vault.json.enc
```

**Solution:** Create a test vault following Step 1 in Initial Setup.

### Error: "Failed to decrypt vault"

```
Error: Failed to decrypt vault. Please check your VAULT_PASSWORD is correct.
```

**Solution:** Verify `VAULT_PASSWORD` in `.env` matches the password used to encrypt the vault.

### Error: "Insufficient balance"

```
Error: Insufficient balance. Required: 0.003571 SOL, Available: 0.000000 SOL
```

**Solution:** Fund the test vault address with more cryptocurrency (see Step 2).

### Error: "Missing required environment variables"

```
Error: Missing required environment variables: VAULT_PASSWORD
```

**Solution:** Create `.env` file in `config/` directory with required variables (see Step 3).

### RPC Rate Limiting

```
Error: 429 Too Many Requests
```

**Solution:**
- Use a private RPC endpoint
- Add delays between tests
- Reduce test frequency

### Transaction Failures

If transactions fail to broadcast:
1. Check you have sufficient balance (including gas fees)
2. Verify RPC endpoint is working
3. Try increasing priority fees
4. Check blockchain explorer for network issues

## Cost Estimation

Approximate costs per test run:

**Solana:**
- Native transfer: $0.50 (test amount) + ~$0.001 (fee) = **$0.501**
- SPL transfer: $0.50 + ~$0.001 = **$0.501**
- Swap: $0.50 + ~$0.01 = **$0.51**
- **Total per run: ~$1.50**

**Ethereum (future):**
- Native transfer: $0.50 + ~$2-5 (gas) = **$2.50-5.50**
- Token transfer: $0.50 + ~$3-8 (gas) = **$3.50-8.50**
- Swap: $0.50 + ~$10-30 (gas) = **$10.50-30.50**
- **Total per run: ~$17-45** (varies greatly with gas prices)

💡 **Tip:** Use layer 2s (Arbitrum, Optimism) or cheaper chains (Polygon, BSC) to reduce costs.

## Maintenance

### Updating Token Prices

Update `MOCK_PRICES` in `config/test-config.ts` periodically to ensure test amounts are accurate:

```typescript
export const MOCK_PRICES = {
  SOL: 140,   // Check current price on CoinGecko
  ETH: 2500,
  // ...
}
```

### Rotating Vault Credentials

To rotate the test vault password:

1. Decrypt existing vault:
```bash
node -e "
  const { loadEncryptedVault } = require('./utils/vault-loader');
  const vault = loadEncryptedVault('old-password');
  require('fs').writeFileSync('temp-vault.json', vault);
"
```

2. Re-encrypt with new password:
```bash
node -e "
  const fs = require('fs');
  const { saveEncryptedVault } = require('./utils/vault-loader');
  const vault = fs.readFileSync('temp-vault.json', 'utf8');
  saveEncryptedVault(vault, 'new-password');
"
```

3. Update `.env` with new password
4. Delete temporary file: `rm temp-vault.json`

### Refilling Test Funds

Monitor balances and refill when running low:

```bash
# Check current balance
yarn test:integration -- --grep "should fetch native SOL balance"
```

## Development

### Running Locally During Development

```bash
# Install dependencies
yarn install

# Run tests in watch mode
yarn test:integration -- --watch

# Run with coverage
yarn test:integration -- --coverage
```

### Debugging

Add breakpoints and use VS Code debugger:

1. Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Integration Tests",
  "runtimeExecutable": "yarn",
  "runtimeArgs": ["test:integration"],
  "env": {
    "DRY_RUN": "true"
  }
}
```

2. Set breakpoints in test files
3. Press F5 to debug

## Support

For issues or questions:
- Create an issue in the repository
- Check existing tests for examples
- Review SDK documentation
- Consult blockchain-specific documentation (Solana, Ethereum, etc.)

## License

Same as parent project.
