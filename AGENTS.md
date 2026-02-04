# Vultisig SDK for AI Agents

> **Quick Reference for AI Agents** integrating Vultisig wallet functionality.
> For complete SDK documentation, see [docs/SDK-USERS-GUIDE.md](./docs/SDK-USERS-GUIDE.md).

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Vault Operations](#vault-operations)
- [Seedphrase Import](#seedphrase-import)
- [Balance & Address Operations](#balance--address-operations)
- [Chain Management](#chain-management)
- [Fiat Values](#fiat-values)
- [Sending Transactions](#sending-transactions)
- [Token Swaps](#token-swaps)
- [Event Handling](#event-handling)
- [CLI Reference](#cli-reference)
- [Common Patterns](#common-patterns)
- [Error Handling](#error-handling)
- [SDK Lifecycle](#sdk-lifecycle)
- [Security Notes](#security-notes)

---

## Overview

Vultisig is a **seedless, multi-party computation (MPC) wallet** supporting 40+ blockchains. The SDK provides:

- **Fast Vaults**: Server-assisted 2-of-2 MPC (instant signing, requires password)
- **Secure Vaults**: Multi-device N-of-M MPC (requires mobile app coordination)

**For agents**, Fast Vaults are typically the best choice — they sign instantly without device coordination.

### Supported Chains

Bitcoin, Ethereum, Solana, THORChain, Cosmos, Avalanche, BSC, Arbitrum, Base, Polygon, Optimism, and 30+ more.

---

## Installation

```bash
npm install @vultisig/sdk
# or
yarn add @vultisig/sdk
```

**Node.js requirement:** v20+

### Platform-Specific Storage

The SDK auto-detects your platform:
- **Node.js**: Files stored in `~/.vultisig/`
- **Browser**: IndexedDB with localStorage fallback
- **Custom**: Pass your own storage implementation

---

## Quick Start

### Initialize SDK

```typescript
import { Vultisig } from '@vultisig/sdk';

const sdk = new Vultisig({
  onPasswordRequired: async (vaultId, vaultName) => {
    // Return the vault password
    // For agents: typically from environment variable or secure config
    return process.env.VAULT_PASSWORD || 'your-vault-password';
  }
});

await sdk.initialize();
```

### Load Existing Vault

```typescript
// List available vaults
const vaults = await sdk.listVaults();
console.log(vaults); // [{ id: '...', name: 'My Vault', type: 'fast' }, ...]

// Get active vault (or first vault if none active)
let vault = await sdk.getActiveVault();

if (!vault && vaults.length > 0) {
  vault = vaults[0];
  await sdk.setActiveVault(vault);
}

// Unlock if encrypted (Fast vaults are always encrypted)
if (vault.type === 'fast' || vault.isEncrypted) {
  await vault.unlock('your-password');
}
```

### Get Addresses

```typescript
// Single chain
const ethAddress = await vault.address('Ethereum');
const btcAddress = await vault.address('Bitcoin');
const thorAddress = await vault.address('THORChain');

// All addresses at once
const allAddresses = await vault.addresses();
// Returns: { Ethereum: '0x...', Bitcoin: 'bc1...', THORChain: 'thor1...', ... }
```

---

## Vault Operations

### Create a New Fast Vault

```typescript
const vaultId = await sdk.createFastVault({
  name: 'Agent Wallet',
  email: 'agent@example.com',
  password: 'secure-password-here',
});

// Email verification required
const vault = await sdk.verifyVault(vaultId, 'email-code-1234');
```

### Import Vault from Backup

```typescript
// Import from .bak file (exported from mobile app)
const vault = await sdk.importVaultFromBackup('./vault-backup.bak', 'backup-password');
```

### Export Vault

```typescript
// Export for backup
const { filename, data } = await vault.export('export-password');
// Save `data` to file system
```

### Delete Vault

```typescript
// Delete vault from storage (irreversible!)
await sdk.deleteVault(vault);

// Clear all vaults
await sdk.clearVaults();
```

---

## Seedphrase Import

Create vaults from existing BIP39 mnemonics (12 or 24 words).

### Validate Seedphrase

```typescript
const isValid = sdk.validateSeedphrase('word1 word2 word3 ... word12');
if (!isValid) {
  throw new Error('Invalid mnemonic');
}
```

### Create Fast Vault from Seedphrase

```typescript
const vault = await sdk.createFastVaultFromSeedphrase({
  name: 'Imported Wallet',
  email: 'agent@example.com',
  password: 'secure-password',
  seedphrase: 'abandon abandon abandon ... about',
});

// Email verification still required for Fast vaults
const verifiedVault = await sdk.verifyVault(vault.id, 'email-code');
```

### Create Secure Vault from Seedphrase

```typescript
const { vault, sessionId } = await sdk.createSecureVaultFromSeedphrase({
  name: 'Secure Imported',
  password: 'secure-password',
  seedphrase: 'abandon abandon abandon ... about',
  devices: ['device1', 'device2'],  // Other signers
});
```

### Discover Chains with Balances

Scan which chains have funds before importing:

```typescript
await sdk.discoverChainsFromSeedphrase(
  'abandon abandon ... about',
  ['Bitcoin', 'Ethereum', 'Solana'],  // Chains to check
  (chain, hasBalance) => {
    if (hasBalance) {
      console.log(`${chain} has funds!`);
    }
  }
);
```

### Join Existing Secure Vault

Join a keygen session initiated by another device:

```typescript
// QR payload from initiating device
const qrPayload = '...scanned from QR...';

const vault = await sdk.joinSecureVault(qrPayload, {
  name: 'Joined Vault',
  password: 'secure-password',
});
```

---

## Balance & Address Operations

### Understanding Balance Format

> **Critical:** Balances are returned in **base units** (satoshis, wei, etc.), NOT human-readable amounts.

The `Balance` object contains:
```typescript
interface Balance {
  amount: string;    // Raw balance in base units (e.g., "30558" for BTC)
  symbol: string;    // Token symbol (e.g., "BTC")
  decimals: number;  // Decimal places (e.g., 8 for BTC, 18 for ETH)
  chainId: string;   // Chain identifier
  tokenId?: string;  // Token contract address (if applicable)
}
```

**Example: BTC balance of 0.00030558**
- `amount`: `"30558"` (satoshis)
- `decimals`: `8`
- Human-readable: `30558 / 10^8 = 0.00030558 BTC`

### Converting Base Units to Human-Readable

```typescript
// Helper to convert base units to human-readable
function toHumanReadable(balance: Balance): string {
  const amount = BigInt(balance.amount);
  const divisor = 10n ** BigInt(balance.decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;

  // Format with proper decimal places
  const fractionStr = fraction.toString().padStart(balance.decimals, '0');
  return `${whole}.${fractionStr}`.replace(/\.?0+$/, '') || '0';
}

// Usage
const balance = await vault.balance('Bitcoin');
console.log(`Raw: ${balance.amount}`);           // "30558"
console.log(`Human: ${toHumanReadable(balance)} ${balance.symbol}`);  // "0.00030558 BTC"
```

### Check Balances

```typescript
// Get all balances across chains
const balances = await vault.balances();
// Returns Balance objects in base units:
// { Bitcoin: { BTC: Balance }, Ethereum: { ETH: Balance, USDC: Balance }, ... }

// Access a specific balance
const btcBalance = balances.Bitcoin?.BTC;
console.log(`BTC: ${toHumanReadable(btcBalance)} BTC`);

// Refresh balances from blockchain
await vault.refreshBalances();
const updatedBalances = await vault.balances();
```

### Token Management

```typescript
// Get tokens configured for a chain
const tokens = await vault.getTokens('Ethereum');

// Add a custom token
await vault.addToken('Ethereum', {
  id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol: 'USDC',
  decimals: 6,
});

// Remove a token
await vault.removeToken('Ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');

// Set all tokens for a chain at once
await vault.setTokens('Ethereum', [
  { id: '0x...USDC', symbol: 'USDC', decimals: 6 },
  { id: '0x...USDT', symbol: 'USDT', decimals: 6 },
]);
```

> **Note:** Automatic token discovery is not yet implemented. Tokens must be added manually.

---

## Chain Management

Manage which chains are active for a vault.

```typescript
// Get active chains
const chains = vault.chains;

// Add a chain
await vault.addChain('Solana');

// Remove a chain
await vault.removeChain('Polygon');

// Set all chains at once
await vault.setChains(['Bitcoin', 'Ethereum', 'Solana', 'THORChain']);

// Reset to SDK defaults
await vault.resetToDefaultChains();

// Check supported swap chains
const swapChains = await vault.getSupportedSwapChains();
```

---

## Fiat Values

Get portfolio values in fiat currency.

```typescript
// Set preferred currency
await vault.setCurrency('USD');  // or 'EUR', 'GBP', etc.

// Get value of a single asset
const ethValueUsd = await vault.getValue('Ethereum');
const btcValueEur = await vault.getValue('Bitcoin', undefined, 'EUR');

// Get value of a specific token
const usdcValue = await vault.getValue('Ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');

// Get total portfolio value
const totalUsd = await vault.getTotalValue('USD');

// Refresh prices and get updated total
await vault.updateTotalValue('USD');

// Refresh all prices
await vault.updateValues('all');
```

> **Note:** The SDK caches prices. Use `updateValues()` to refresh.

---

## Sending Transactions

> **Important:** The SDK requires amounts as `bigint` in base units (wei, satoshis, etc.), not human-readable strings.

### Amount Conversion Helper

```typescript
// Helper to convert human-readable amounts to base units (precision-safe)
function toBaseUnits(amount: string, decimals: number): bigint {
  const s = amount.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid amount: ${amount}`);

  const negative = s.startsWith('-');
  const abs = negative ? s.slice(1) : s.replace(/^\+/, '');
  const [whole, frac = ''] = abs.split('.');

  // Pad or truncate fractional part to exactly `decimals` digits
  const fracPadded = frac.length <= decimals
    ? frac.padEnd(decimals, '0')
    : frac.slice(0, decimals);

  const digits = whole + fracPadded;
  const result = BigInt(digits);
  return negative ? -result : result;
}

// Examples:
toBaseUnits('1.5', 18);                   // 1500000000000000000n (1.5 ETH in wei)
toBaseUnits('0.001', 8);                  // 100000n (0.001 BTC in satoshis)
toBaseUnits('100', 6);                    // 100000000n (100 USDC)
toBaseUnits('1.123456789012345678', 18);  // 1123456789012345678n (exact)
```

### Send Native Token (ETH, BTC, etc.)

```typescript
import { Chain } from '@vultisig/sdk';

// 1. Get sender address and build AccountCoin
const senderAddress = await vault.address(Chain.Ethereum);

const coin = {
  chain: Chain.Ethereum,
  address: senderAddress,
  decimals: 18,
  ticker: 'ETH',
};

// 2. Prepare the transaction (amount in base units!)
const sendPayload = await vault.prepareSendTx({
  coin,
  receiver: '0xRecipientAddress...',
  amount: toBaseUnits('0.01', 18),  // 0.01 ETH = 10000000000000000n wei
  memo: 'Optional memo',
});

// 3. Extract message hashes for signing
const messageHashes = await vault.extractMessageHashes(sendPayload);

// 4. Sign the transaction
const signature = await vault.sign({
  transaction: sendPayload,
  chain: Chain.Ethereum,
  messageHashes,
});

// 5. Broadcast to network
const txHash = await vault.broadcastTx({
  chain: Chain.Ethereum,
  keysignPayload: sendPayload,
  signature,
});

console.log('Transaction sent:', txHash);
```

### Send ERC-20 Token

```typescript
const senderAddress = await vault.address(Chain.Ethereum);

// For tokens, include the contract address as `id`
const usdcCoin = {
  chain: Chain.Ethereum,
  address: senderAddress,
  decimals: 6,  // USDC has 6 decimals
  ticker: 'USDC',
  id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',  // USDC contract
};

const sendPayload = await vault.prepareSendTx({
  coin: usdcCoin,
  receiver: '0xRecipientAddress...',
  amount: toBaseUnits('100', 6),  // 100 USDC = 100000000n
});

// ... extract hashes, sign, and broadcast same as above
```

### Send Bitcoin

```typescript
const senderAddress = await vault.address(Chain.Bitcoin);

const btcCoin = {
  chain: Chain.Bitcoin,
  address: senderAddress,
  decimals: 8,
  ticker: 'BTC',
};

const sendPayload = await vault.prepareSendTx({
  coin: btcCoin,
  receiver: 'bc1qRecipientAddress...',
  amount: toBaseUnits('0.001', 8),  // 0.001 BTC = 100000n satoshis
});

// ... extract hashes, sign, and broadcast same as above
```

### Complete Send Helper (Recommended)

```typescript
/**
 * Complete send flow wrapped in a single function
 */
async function sendTokens(
  vault: VaultBase,
  chain: Chain,
  to: string,
  amount: string,  // Human-readable (e.g., "0.01")
  tokenId?: string,
  memo?: string
): Promise<string> {
  // 1. Get balance info for decimals
  const balance = await vault.balance(chain, tokenId);
  const senderAddress = await vault.address(chain);

  // 2. Build coin object
  const coin = {
    chain,
    address: senderAddress,
    decimals: balance.decimals,
    ticker: balance.symbol,
    id: tokenId,
  };

  // 3. Convert to base units
  const amountBaseUnits = toBaseUnits(amount, balance.decimals);

  // 4. Prepare transaction
  const payload = await vault.prepareSendTx({
    coin,
    receiver: to,
    amount: amountBaseUnits,
    memo,
  });

  // 5. Extract hashes and sign
  const messageHashes = await vault.extractMessageHashes(payload);
  const signature = await vault.sign({
    transaction: payload,
    chain,
    messageHashes,
  });

  // 6. Broadcast
  return vault.broadcastTx({
    chain,
    keysignPayload: payload,
    signature,
  });
}

// Usage:
const txHash = await sendTokens(vault, Chain.Ethereum, '0xRecipient...', '0.5');
const txHash2 = await sendTokens(vault, Chain.Ethereum, '0xRecipient...', '100', '0xUSDC...');
```

---

## Token Swaps

The SDK supports cross-chain and same-chain swaps via multiple providers:

| Provider | Type | Best For |
|----------|------|----------|
| **THORChain** | Cross-chain DEX | BTC ↔ ETH, native assets |
| **MayaChain** | Cross-chain DEX | Alternative routes |
| **1inch** | DEX aggregator | Same-chain EVM swaps |
| **KyberSwap** | DEX aggregator | Same-chain EVM swaps |
| **LiFi** | Bridge aggregator | Cross-chain EVM |

The SDK automatically selects the best provider based on the route.

### Simple Swap

```typescript
// Using the swap service
const swapService = vault.swapService;

// Get a quote first
const quote = await swapService.getQuote({
  fromChain: 'Ethereum',
  fromAsset: 'ETH',
  toChain: 'Bitcoin', 
  toAsset: 'BTC',
  amount: '0.1',  // 0.1 ETH
});

console.log('Expected output:', quote.expectedOutput);
console.log('Minimum output:', quote.minOutput);

// Execute the swap
const swapPayload = await swapService.prepareSwap({
  fromChain: 'Ethereum',
  fromAsset: 'ETH',
  toChain: 'Bitcoin',
  toAsset: 'BTC',
  amount: '0.1',
  minOutput: quote.minOutput,
  destination: await vault.address('Bitcoin'),
});

// Sign and broadcast
const hashes = await vault.extractMessageHashes(swapPayload);
const sig = await vault.sign({
  transaction: swapPayload,
  chain: Chain.Ethereum,
  messageHashes: hashes,
});
const txHash = await vault.broadcastTx({
  chain: Chain.Ethereum,
  keysignPayload: swapPayload,
  signature: sig,
});
```

### THORChain Secured Assets (Trade Assets)

For depositing to THORChain's secured layer:

```typescript
import { Chain } from '@vultisig/sdk';

// Deposit L1 asset to secured layer
// Memo format: SECURE+:thorAddress
const thorAddress = await vault.address(Chain.THORChain);
const depositMemo = `SECURE+:${thorAddress}`;

// Get inbound address from THORNode
const inboundResponse = await fetch('https://thornode.ninerealms.com/thorchain/inbound_addresses');
const inbounds = await inboundResponse.json();
const ethInbound = inbounds.find(i => i.chain === 'ETH');

// Build coin object
const senderAddress = await vault.address(Chain.Ethereum);
const ethCoin = {
  chain: Chain.Ethereum,
  address: senderAddress,
  decimals: 18,
  ticker: 'ETH',
};

// Prepare L1 transaction with memo (amount in wei!)
const depositPayload = await vault.prepareSendTx({
  coin: ethCoin,
  receiver: ethInbound.address,
  amount: 10000000000000000n,  // 0.01 ETH in wei
  memo: depositMemo,
});

// Extract hashes, sign, and broadcast...
const messageHashes = await vault.extractMessageHashes(depositPayload);
const signature = await vault.sign({
  transaction: depositPayload,
  chain: Chain.Ethereum,
  messageHashes,
});
const txHash = await vault.broadcastTx({
  chain: Chain.Ethereum,
  keysignPayload: depositPayload,
  signature,
});
```

---

## Event Handling

The SDK emits events for reactive agent architectures.

```typescript
// Balance updates
vault.on('balanceUpdated', (chain, tokenId, balance) => {
  console.log(`${chain} balance changed: ${balance}`);
});

// Transaction lifecycle
vault.on('transactionSigned', (txHash, chain) => {
  console.log(`Signed tx ${txHash} on ${chain}`);
});

vault.on('transactionBroadcast', (txHash, chain) => {
  console.log(`Broadcast tx ${txHash} on ${chain}`);
});

// Signing progress (useful for UI feedback)
vault.on('signingProgress', (step, totalSteps, message) => {
  console.log(`Signing: ${step}/${totalSteps} - ${message}`);
});

// Error events
vault.on('error', (error) => {
  console.error('Vault error:', error.message);
});

// Remove listener
vault.off('balanceUpdated', myHandler);

// One-time listener
vault.once('transactionBroadcast', (txHash) => {
  console.log('First transaction sent!');
});
```

### Event Types

| Event | Payload | When |
|-------|---------|------|
| `balanceUpdated` | `(chain, tokenId, balance)` | After `updateBalance()` |
| `transactionSigned` | `(txHash, chain)` | After `sign()` completes |
| `transactionBroadcast` | `(txHash, chain)` | After `broadcastTx()` succeeds |
| `signingProgress` | `(step, total, message)` | During MPC signing |
| `error` | `(VaultError)` | On any vault error |

---

## CLI Reference

For quick operations, use the CLI instead of writing code:

```bash
# Install globally
npm install -g @vultisig/cli

# Or use via npx
npx @vultisig/cli --help
```

### Authentication

```bash
# Via environment variable (recommended for agents)
VAULT_PASSWORD=your-password vultisig balance

# Via flag
vultisig balance --password your-password
```

### Vault Management

```bash
# List all vaults
vultisig vaults

# Show vault details
vultisig info

# Switch active vault
vultisig switch <vault-id>

# Rename vault
vultisig rename "New Name"

# Create new fast vault (subcommand)
vultisig create fast --name "Agent Wallet" --email "agent@example.com" --password "secret"

# Verify email code
vultisig verify <vaultId> --code <code>

# Create secure vault (subcommand)
vultisig create secure --name "Secure Wallet"

# Join secure vault keygen (subcommand)
vultisig join secure --qr "vultisig://..."

# Import vault from backup
vultisig import ./backup.vult

# Export vault
vultisig export ./backup.vult
```

### Seedphrase Operations

```bash
# Create fast vault from mnemonic (subcommand)
vultisig create-from-seedphrase fast --name "Imported" --email "a@b.com" --password "secret"

# Create secure vault from mnemonic (subcommand)
vultisig create-from-seedphrase secure --name "Imported Secure"
```

### Balances & Addresses

```bash
# Get all addresses
vultisig addresses

# Check all balances
vultisig balance

# Check specific chain balance
vultisig balance ethereum

# Include token balances
vultisig balance ethereum --tokens

# Get total portfolio value
vultisig portfolio

# Set fiat currency
vultisig currency USD
```

### Transactions

```bash
# Send native token
vultisig send ethereum 0xRecipient 0.01

# Send with memo
vultisig send ethereum 0xRecipient 0.01 --memo "Payment"

# Send ERC-20 token
vultisig send ethereum 0xRecipient 100 --token 0xUSDC...

# Sign arbitrary bytes (base64 encoded)
vultisig sign --chain ethereum --bytes "base64encodeddata"

# Broadcast raw transaction
vultisig broadcast --chain ethereum --raw-tx <hex-encoded-tx>
```

### Swaps

```bash
# Swap native tokens (cross-chain)
vultisig swap ethereum bitcoin 0.1

# Swap with specific tokens
vultisig swap ethereum bitcoin 0.1 --from-token 0xUSDC... --to-token native

# Get swap quote only (no execution)
vultisig swap-quote ethereum bitcoin 0.1

# List supported swap chains
vultisig swap-chains

# Skip confirmation prompt
vultisig swap ethereum bitcoin 0.1 --yes
```

### Token & Chain Management

```bash
# List tokens for a chain
vultisig tokens ethereum

# Add custom token (with options)
vultisig tokens ethereum --add 0xContractAddress --symbol USDC --decimals 6

# Remove token
vultisig tokens ethereum --remove 0xContractAddress

# List active chains
vultisig chains

# Add chain
vultisig chains --add solana

# Remove chain
vultisig chains --remove polygon
```

### Address Book

```bash
# List address book
vultisig address-book

# Add entry (with options)
vultisig address-book --add --name "Alice" --address 0x... --chain ethereum

# Remove entry
vultisig address-book --remove 0x...
```

### Diagnostics

```bash
# Check server status
vultisig server
```

---

## Common Patterns

### Pattern 1: Agent Wallet Setup

```typescript
import { Vultisig } from '@vultisig/sdk';

async function initializeAgentWallet() {
  const sdk = new Vultisig({
    onPasswordRequired: async () => process.env.VAULT_PASSWORD!,
  });
  
  await sdk.initialize();
  
  let vault = await sdk.getActiveVault();
  if (!vault) {
    const vaults = await sdk.listVaults();
    if (vaults.length === 0) {
      throw new Error('No vault found. Create one first.');
    }
    vault = vaults[0];
    await sdk.setActiveVault(vault);
  }
  
  // Unlock for Fast vaults
  if (vault.type === 'fast' && !vault.isUnlocked()) {
    await vault.unlock(process.env.VAULT_PASSWORD!);
  }
  
  return { sdk, vault };
}
```

### Pattern 2: Safe Transaction Sending

```typescript
import { Chain, VaultBase } from '@vultisig/sdk';

/**
 * Safe send with balance check and proper error handling.
 * Uses correct SDK API with AccountCoin and bigint amounts.
 */
async function safeSend(
  vault: VaultBase,
  chain: Chain,
  to: string,
  amount: string,  // Human-readable (e.g., "0.5")
  tokenId?: string,
  memo?: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    // 1. Get balance and check sufficiency
    const balance = await vault.balance(chain, tokenId);
    const amountBaseUnits = toBaseUnits(amount, balance.decimals);

    if (BigInt(balance.amount) < amountBaseUnits) {
      throw new Error(
        `Insufficient balance: ${balance.amount} base units < ${amountBaseUnits} base units`
      );
    }

    // 2. Build AccountCoin
    const senderAddress = await vault.address(chain);
    const coin = {
      chain,
      address: senderAddress,
      decimals: balance.decimals,
      ticker: balance.symbol,
      id: tokenId,
    };

    // 4. Prepare transaction
    const payload = await vault.prepareSendTx({
      coin,
      receiver: to,
      amount: amountBaseUnits,
      memo,
    });

    // 5. Extract hashes and sign
    const messageHashes = await vault.extractMessageHashes(payload);
    const signature = await vault.sign({
      transaction: payload,
      chain,
      messageHashes,
    });

    // 6. Broadcast
    const txHash = await vault.broadcastTx({
      chain,
      keysignPayload: payload,
      signature,
    });

    return { success: true, txHash };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

// Usage:
const result = await safeSend(vault, Chain.Ethereum, '0xRecipient...', '0.5');
if (result.success) {
  console.log('TX:', result.txHash);
} else {
  console.error('Failed:', result.error);
}
```

### Pattern 3: Multi-Chain Balance Check

```typescript
async function getPortfolioValue(vault, prices) {
  const balances = await vault.balances();
  let totalUsd = 0;

  for (const [chain, tokens] of Object.entries(balances)) {
    for (const [token, balance] of Object.entries(tokens)) {
      const amount = parseFloat(balance.amount || '0');
      const price = prices[token] || 0;
      totalUsd += amount * price;
    }
  }

  return totalUsd;
}
```

---

## Error Handling

### Common Errors

| Error Code | Cause | Solution | Retryable |
|------------|-------|----------|-----------|
| `INVALID_CONFIG` | Vault locked or misconfigured | Call `vault.unlock(password)` | Yes |
| `SIGNING_FAILED` | MPC signing process failed | Retry, check server status | Yes |
| `NETWORK_ERROR` | Server unreachable | Retry with backoff | Yes |
| `BROADCAST_FAILED` | Transaction rejected by network | Check tx params, gas | Maybe |
| `BALANCE_FETCH_FAILED` | RPC endpoint issue | Retry, check chain status | Yes |
| `GAS_ESTIMATION_FAILED` | Cannot estimate gas | Check amount, recipient | No |
| `UNSUPPORTED_CHAIN` | Chain not supported | Use supported chain | No |
| `ADDRESS_DERIVATION_FAILED` | Key derivation issue | Check vault integrity | No |
| `INVALID_VAULT` | Corrupted vault data | Re-import vault | No |

### Error Handling Pattern

```typescript
import { VaultError, VaultErrorCode, StorageError, StorageErrorCode } from '@vultisig/sdk';

try {
  // Prepare and send transaction
  const payload = await vault.prepareSendTx({ chain, to, amount });
  const hashes = await vault.extractMessageHashes(payload);
  const signature = await vault.sign({ messages: hashes });
  const txHash = await vault.broadcastTx({ chain, signedTx: signature, keysignPayload: payload });
} catch (error) {
  if (error instanceof VaultError) {
    switch (error.code) {
      case VaultErrorCode.InvalidConfig:
        // Vault may be locked
        await vault.unlock(password);
        // Retry operation
        break;
      case VaultErrorCode.SigningFailed:
      case VaultErrorCode.NetworkError:
        // Retryable - wait and retry
        await sleep(2000);
        // Retry operation
        break;
      case VaultErrorCode.BroadcastFailed:
        console.error('Transaction rejected:', error.message);
        break;
      case VaultErrorCode.UnsupportedChain:
        console.error('Chain not supported');
        break;
      default:
        console.error('Vault error:', error.code, error.message);
    }
  } else if (error instanceof StorageError) {
    switch (error.code) {
      case StorageErrorCode.QuotaExceeded:
        console.error('Storage full');
        break;
      case StorageErrorCode.DecryptionFailed:
        console.error('Wrong password or corrupted data');
        break;
      default:
        console.error('Storage issue:', error.message);
    }
  } else {
    throw error;  // Unknown error
  }
}
```

> **Note:** There is no `INSUFFICIENT_FUNDS` error code. Always check balances before sending:
> ```typescript
> const balance = await vault.balance(chain);
> if (parseFloat(balance) < parseFloat(amount)) {
>   throw new Error('Insufficient balance');
> }
> ```

---

## SDK Lifecycle

Proper initialization and cleanup for long-running agents.

### Initialization

```typescript
const sdk = new Vultisig({
  onPasswordRequired: async () => process.env.VAULT_PASSWORD!,

  // Optional: auto-initialize on construction
  autoInit: true,

  // Optional: configure default chains for new vaults
  defaultChains: ['Bitcoin', 'Ethereum', 'Solana'],

  // Optional: set default fiat currency
  defaultCurrency: 'USD',

  // Optional: configure cache TTLs (milliseconds)
  cacheConfig: {
    balance: 30000,      // Balance cache: 30s
    address: 3600000,    // Address cache: 1hr
    price: 60000,        // Price cache: 1min
  },

  // Optional: password cache TTL
  passwordCache: {
    defaultTTL: 300000,  // 5 minutes
  },
});

// If autoInit is false (default), initialize manually
await sdk.initialize();

// Check initialization state
console.log('Initialized:', sdk.initialized);
```

### Cleanup (Critical!)

**Always dispose the SDK when done.** This:
- Zeros passwords in memory (security)
- Clears pending operations
- Releases resources

```typescript
// ALWAYS call dispose when shutting down
await sdk.dispose();

// Check disposal state
console.log('Disposed:', sdk.disposed);

// After dispose, SDK is unusable
// Create a new instance if needed
```

### Password Cache Management

```typescript
// Check if vault is unlocked
if (!vault.isUnlocked()) {
  await vault.unlock(password);
}

// Check time remaining on password cache
const ttlMs = vault.getUnlockTimeRemaining();
console.log(`Password cached for ${ttlMs / 1000}s more`);

// Manually clear password from cache (security)
vault.lock();
```

### Server Health Check

```typescript
// Check MPC server connectivity
const status = await sdk.getServerStatus();
if (!status.healthy) {
  console.error('Server unavailable:', status.message);
}
```

### Graceful Shutdown Pattern

```typescript
import { Vultisig } from '@vultisig/sdk';

let sdk: Vultisig | null = null;

async function main() {
  sdk = new Vultisig({
    onPasswordRequired: async () => process.env.VAULT_PASSWORD!,
  });
  await sdk.initialize();

  // ... your agent logic ...
}

// Handle shutdown signals
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  if (sdk && !sdk.disposed) {
    await sdk.dispose();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (sdk && !sdk.disposed) {
    await sdk.dispose();
  }
  process.exit(0);
});

main().catch(console.error);
```

---

## Security Notes

### For AI Agents

1. **Never log passwords or private keys** — They don't exist in complete form (MPC), but still protect passwords.

2. **Use environment variables** for vault passwords:
   ```typescript
   const password = process.env.VAULT_PASSWORD;
   ```

3. **Validate all inputs** — Especially recipient addresses and amounts.

4. **Rate limit operations** — Don't spam the MPC server.

5. **Handle errors gracefully** — Network issues, timeouts, and invalid states.

### Vault Types for Agents

| Vault Type | Best For | Signing Speed | Security |
|------------|----------|---------------|----------|
| **Fast Vault** | Automated agents | Instant (~2s) | Server-assisted 2-of-2 |
| **Secure Vault** | Human oversight | Requires devices | N-of-M threshold |

**Recommendation:** Use Fast Vaults for agent automation. They provide instant signing while maintaining MPC security.

---

## Known Issues

### Token Decimals May Default to 18

If a token isn't in the SDK's token registry, its decimals default to 18 (standard ERC-20). This can cause incorrect balance display for tokens like USDC (6 decimals) or USDT (6 decimals).

**Workaround:** Always specify decimals when adding tokens:

```typescript
// Explicitly set correct decimals
await vault.addToken('Ethereum', {
  id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  symbol: 'USDC',
  decimals: 6,  // USDC has 6 decimals, not 18
});
```

### Common Token Decimals Reference

| Token | Decimals | Chain |
|-------|----------|-------|
| USDC | 6 | Ethereum, Polygon, Arbitrum, Base |
| USDT | 6 | Ethereum, Polygon, Arbitrum |
| DAI | 18 | Ethereum, Polygon |
| WBTC | 8 | Ethereum |
| BTC | 8 | Bitcoin |
| ETH | 18 | Ethereum |
| SOL | 9 | Solana |
| ATOM | 6 | Cosmos |

---

## Resources

- **Full SDK Guide**: [docs/SDK-USERS-GUIDE.md](./docs/SDK-USERS-GUIDE.md)
- **API Reference**: [https://vultisig.github.io/vultisig-sdk/](https://vultisig.github.io/vultisig-sdk/)
- **Examples**: [examples/](./examples/)
- **CLI Reference**: `vultisig --help`
- **Discord**: [discord.gg/vultisig](https://discord.gg/vultisig)

---

## Changelog

- **2026-02-02**: Balance format documentation
  - Added "Understanding Balance Format" section explaining base units
  - Added `toHumanReadable()` helper function for display
  - Added "Known Issues" section documenting token decimals defaults
  - Added common token decimals reference table
- **2026-02-02**: CLI command fixes
  - Fixed `vultisig list` → `vultisig vaults`
  - Fixed `vultisig address` → `vultisig addresses`
  - Fixed `vultisig create-fast` → `vultisig create fast` (subcommand)
  - Fixed `vultisig create-secure` → `vultisig create secure`
  - Fixed `vultisig join-secure` → `vultisig join secure`
  - Fixed swap command format (was `chain:token`, now `<fromChain> <toChain>`)
  - Fixed tokens/chains/address-book to use `--add`/`--remove` options
  - Fixed sign/broadcast command option formats
- **2026-02-02**: Critical API corrections
  - **BREAKING:** Fixed `prepareSendTx` signature - was showing wrong params
    - `chain` → `coin` (AccountCoin object)
    - `to` → `receiver`
    - `amount: string` → `amount: bigint` (base units, not human-readable!)
    - `token` → `coin.id`
  - Fixed `sign()` signature - `messages` → `messageHashes`, added `transaction` and `chain`
  - Fixed `broadcastTx()` signature - `signedTx` → `signature`
  - Added amount conversion helper (`toBaseUnits`)
  - Added complete `sendTokens()` helper function
  - Fixed all code examples (send, swap, THORChain deposit)
  - Fixed Pattern 2 (Safe Transaction Sending) with correct API
- **2026-02-02**: Major documentation update
  - Fixed error codes to match actual implementation
  - Fixed balance access pattern in examples
  - Added seedphrase import section
  - Added chain management section
  - Added fiat values section
  - Added event handling section
  - Added SDK lifecycle section
  - Expanded CLI reference (5 → 23+ commands)
  - Added swap providers (THORChain, MayaChain, 1inch, KyberSwap, LiFi)
  - Replaced non-existent `discoverTokens()` with token management docs
- **2026-02-02**: Initial agent-focused documentation
