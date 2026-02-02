# Vultisig SDK for AI Agents

> **Quick Reference for AI Agents** integrating Vultisig wallet functionality.
> For complete SDK documentation, see [docs/SDK-USERS-GUIDE.md](./docs/SDK-USERS-GUIDE.md).

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Vault Operations](#vault-operations)
- [Balance & Address Operations](#balance--address-operations)
- [Sending Transactions](#sending-transactions)
- [Token Swaps](#token-swaps)
- [CLI Alternative](#cli-alternative)
- [Common Patterns](#common-patterns)
- [Error Handling](#error-handling)
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
await vault.export('./my-vault-backup.bak', 'export-password');
```

---

## Balance & Address Operations

### Check Balances

```typescript
// Get all balances across chains
const balances = await vault.balances();
// Returns: { Bitcoin: { BTC: '0.001' }, Ethereum: { ETH: '0.5', USDC: '100' }, ... }

// Refresh balances from blockchain
await vault.refreshBalances();
const updatedBalances = await vault.balances();
```

### Token Discovery

```typescript
// Discover tokens on a specific chain
const tokens = await vault.discoverTokens('Ethereum');
```

---

## Sending Transactions

### Send Native Token (ETH, BTC, etc.)

```typescript
// Prepare the transaction
const sendPayload = await vault.prepareSendTx({
  chain: 'Ethereum',
  to: '0xRecipientAddress...',
  amount: '0.01',  // In human-readable units (ETH, not wei)
  memo: 'Optional memo',
});

// Extract message hashes for signing
const messageHashes = await vault.extractMessageHashes(sendPayload);

// Sign the transaction (Fast vault signs instantly)
const signature = await vault.sign({
  messages: messageHashes,
  // For Fast vaults, no additional params needed
});

// Broadcast to network
const txHash = await vault.broadcastTx({
  chain: 'Ethereum',
  signedTx: signature,
  keysignPayload: sendPayload,
});

console.log('Transaction sent:', txHash);
```

### Send ERC-20 Token

```typescript
const sendPayload = await vault.prepareSendTx({
  chain: 'Ethereum',
  to: '0xRecipientAddress...',
  amount: '100',  // 100 USDC
  token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',  // USDC contract
});

// ... sign and broadcast same as above
```

### Send Bitcoin

```typescript
const sendPayload = await vault.prepareSendTx({
  chain: 'Bitcoin',
  to: 'bc1qRecipientAddress...',
  amount: '0.001',  // BTC
});

// ... sign and broadcast same as above
```

---

## Token Swaps

The SDK supports swaps via THORChain.

### Simple Swap (THORChain)

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
const sig = await vault.sign({ messages: hashes });
const txHash = await vault.broadcastTx({
  chain: 'Ethereum',
  signedTx: sig,
  keysignPayload: swapPayload,
});
```

### THORChain Secured Assets (Trade Assets)

For depositing to THORChain's secured layer:

```typescript
// Deposit L1 asset to secured layer
// Memo format: SECURE+:thorAddress
const thorAddress = await vault.address('THORChain');
const depositMemo = `SECURE+:${thorAddress}`;

// Get inbound address from THORNode
const inboundResponse = await fetch('https://thornode.ninerealms.com/thorchain/inbound_addresses');
const inbounds = await inboundResponse.json();
const ethInbound = inbounds.find(i => i.chain === 'ETH');

// Prepare L1 transaction with memo
const depositPayload = await vault.prepareSendTx({
  chain: 'Ethereum',
  to: ethInbound.address,
  amount: '0.01',
  memo: depositMemo,
});

// Sign and broadcast...
```

---

## CLI Alternative

For quick operations, use the CLI instead of writing code:

```bash
# Install globally
npm install -g @vultisig/cli

# Or use via npx
npx @vultisig/cli --help
```

### Common CLI Commands

```bash
# List vaults
vultisig list

# Get addresses
vultisig address

# Check balance
vultisig balance

# Send transaction
vultisig send ethereum 0xRecipient 0.01

# Swap tokens
vultisig swap ethereum:eth bitcoin:btc 0.1
```

### CLI with Password

```bash
# Via environment variable (recommended for agents)
VAULT_PASSWORD=your-password vultisig balance

# Via flag
vultisig balance --password your-password
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
async function safeSend(vault, chain, to, amount) {
  try {
    // 1. Check balance first
    const balances = await vault.balances();
    const chainBalance = balances[chain]?.[chain] || '0';
    
    if (parseFloat(chainBalance) < parseFloat(amount)) {
      throw new Error(`Insufficient balance: ${chainBalance} < ${amount}`);
    }
    
    // 2. Prepare transaction
    const payload = await vault.prepareSendTx({ chain, to, amount });
    
    // 3. Sign
    const hashes = await vault.extractMessageHashes(payload);
    const signature = await vault.sign({ messages: hashes });
    
    // 4. Broadcast
    const txHash = await vault.broadcastTx({
      chain,
      signedTx: signature,
      keysignPayload: payload,
    });
    
    return { success: true, txHash };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

### Pattern 3: Multi-Chain Balance Check

```typescript
async function getPortfolioValue(vault, prices) {
  const balances = await vault.balances();
  let totalUsd = 0;
  
  for (const [chain, tokens] of Object.entries(balances)) {
    for (const [token, amount] of Object.entries(tokens)) {
      const price = prices[token] || 0;
      totalUsd += parseFloat(amount) * price;
    }
  }
  
  return totalUsd;
}
```

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Vault is locked` | Fast vault needs password | Call `vault.unlock(password)` |
| `No vault found` | No vaults in storage | Create or import a vault first |
| `Insufficient funds` | Balance too low | Check balance before sending |
| `MPC timeout` | Server unreachable | Retry, check network connection |
| `Invalid address` | Wrong address format | Verify address format for chain |

### Error Handling Pattern

```typescript
import { VaultError, StorageError } from '@vultisig/sdk';

try {
  await vault.send(...);
} catch (error) {
  if (error instanceof VaultError) {
    if (error.code === 'VAULT_LOCKED') {
      await vault.unlock(password);
      // Retry operation
    } else if (error.code === 'INSUFFICIENT_FUNDS') {
      console.error('Not enough balance');
    }
  } else if (error instanceof StorageError) {
    console.error('Storage issue:', error.message);
  } else {
    throw error;  // Unknown error
  }
}
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

## Resources

- **Full SDK Guide**: [docs/SDK-USERS-GUIDE.md](./docs/SDK-USERS-GUIDE.md)
- **API Reference**: [https://vultisig.github.io/vultisig-sdk/](https://vultisig.github.io/vultisig-sdk/)
- **Examples**: [examples/](./examples/)
- **CLI Reference**: `vultisig --help`
- **Discord**: [discord.gg/vultisig](https://discord.gg/vultisig)

---

## Changelog

- **2026-02-02**: Initial agent-focused documentation
