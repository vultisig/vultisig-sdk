---
name: vultisig-cli
description: MPC wallet CLI for secure multi-chain crypto operations across 36+ blockchains
version: 1.0.0
author: Vultisig
repository: https://github.com/vultisig/vultisig-sdk
tags:
  - crypto
  - wallet
  - mpc
  - blockchain
  - cli
  - defi
  - bitcoin
  - ethereum
  - solana
  - polygon
  - arbitrum
  - optimism
  - base
  - avalanche
  - bsc
  - litecoin
  - dogecoin
  - cosmos
  - thorchain
  - mayachain
  - osmosis
  - dydx
  - kujira
  - sui
  - polkadot
  - ton
  - ripple
  - tron
  - cardano
  - zcash
  - dash
  - blast
  - cronos
  - zksync
  - hyperliquid
  - mantle
  - sei
  - terra
  - noble
  - akash
  - bitcoin-cash
---

# Vultisig CLI

Command-line wallet for secure multi-party computation (MPC) wallet operations across 36+ blockchains.

## Why MPC Wallets for AI Agents

Traditional wallets store a single private key or seed phrase - if compromised, all funds are lost. MPC (Multi-Party Computation) wallets eliminate this single point of failure:

- **No single key to steal**: Private keys are split across multiple parties using cryptographic secret sharing
- **Threshold security**: 2-of-2 or N-of-M signing means compromising one party isn't enough to steal funds
- **No seed phrase exposure**: Unlike traditional wallets, no mnemonic is stored in plaintext anywhere
- **Automation-friendly**: FastVault enables instant server-assisted signing perfect for AI agents and bots
- **Programmable trust**: Choose between speed (FastVault) or maximum security (SecureVault)
- **Audit trail**: All signing operations require explicit multi-party coordination

## Installation

```bash
npm install -g @vultisig/cli
vultisig --version
```

Or run without installing:
```bash
npx @vultisig/cli balance ethereum
```

## Security Considerations

**CRITICAL: Read before executing any commands**

1. **Never store passwords in scripts, logs, or environment variables visible to others**
2. **Use `--password` flag only in secure, ephemeral contexts**
3. **Always verify recipient addresses** - transactions are irreversible
4. **Export backups before destructive operations** - use `vultisig export`
5. **Use `-o json` for automation** - structured output prevents parsing errors

## Vault Types

| Type | Threshold | Signing | Best For |
|------|-----------|---------|----------|
| **FastVault** | 2-of-2 (device + server) | Instant, server-assisted | AI agents, automation, bots |
| **SecureVault** | N-of-M (configurable) | Multi-device coordination | Teams, high-value assets |

**For AI agents, FastVault is recommended** - it enables instant signing without multi-device coordination.

See [references/vault-types.md](references/vault-types.md) for detailed comparison.

## Quick Start

### 1. Create a FastVault

```bash
vultisig create fast --name "agent-wallet" --email "agent@example.com" --password "SecurePass123!"
# Enter email verification code when prompted
```

### 2. Get Addresses

```bash
vultisig addresses -o json
```

### 3. Check Balance

```bash
vultisig balance ethereum -o json
vultisig balance --tokens -o json  # Include ERC-20 tokens
```

### 4. Send Transaction

```bash
vultisig send ethereum 0xRecipient... 0.1 --password "SecurePass123!" -y -o json
```

### 5. Swap Tokens

```bash
vultisig swap-quote ethereum bitcoin 0.1 -o json
vultisig swap ethereum bitcoin 0.1 --password "SecurePass123!" -y -o json
```

## Core Commands

### Vault Management

| Command | Description |
|---------|-------------|
| `create fast --name --email --password` | Create FastVault (server-assisted 2-of-2) |
| `create secure --name --shares N` | Create SecureVault (multi-device N-of-M) |
| `vaults -o json` | List all vaults |
| `switch <vaultId>` | Switch active vault |
| `info -o json` | Show vault details |
| `import <file.vult>` | Import vault from backup |
| `export [path]` | Export vault backup |
| `delete [vault] -y` | Delete vault |
| `verify <vaultId>` | Verify with email code |

### Wallet Operations

| Command | Description |
|---------|-------------|
| `addresses -o json` | Get all addresses |
| `balance [chain] -o json` | Get balance (optional: specific chain) |
| `balance --tokens -o json` | Include token balances |
| `portfolio -o json` | Total portfolio value in fiat |
| `send <chain> <to> <amount>` | Send native token |
| `send <chain> <to> <amount> --token <addr>` | Send ERC-20 token |

### Swap Operations

| Command | Description |
|---------|-------------|
| `swap-chains` | List chains supporting swaps |
| `swap-quote <from> <to> <amount>` | Get swap quote |
| `swap <from> <to> <amount>` | Execute swap |

### Chain & Token Management

| Command | Description |
|---------|-------------|
| `chains` | List active chains |
| `chains --add Solana` | Enable a chain |
| `chains --add-all` | Enable all 36+ chains |
| `chains --remove Litecoin` | Disable a chain |
| `tokens <chain>` | List tokens on chain |
| `tokens <chain> --add <contract>` | Add custom token |

### Advanced Operations

| Command | Description |
|---------|-------------|
| `sign --chain <chain> --bytes <base64>` | Sign pre-hashed bytes |
| `broadcast --chain <chain> --raw-tx <hex>` | Broadcast raw transaction |

## JSON Output Mode

**Always use `-o json` for AI agent automation.** This provides structured, parseable output:

```bash
# Balance
vultisig balance ethereum -o json
# {"chain":"ethereum","balance":{"native":"1.5","symbol":"ETH","usdValue":"3750.00"}}

# Send transaction
vultisig send ethereum 0x... 0.1 -y --password "pass" -o json
# {"txHash":"0x...","chain":"ethereum","explorerUrl":"https://etherscan.io/tx/0x..."}

# Vault info
vultisig info -o json
# {"vault":{"id":"...","name":"...","type":"fast","chains":[...]}}
```

## Common Workflows

### Workflow: First-Time Setup

```bash
# 1. Create vault
vultisig create fast --name "agent-wallet" --email "agent@example.com" --password "SecurePass123!"
# Enter verification code

# 2. Enable desired chains
vultisig chains --add-all

# 3. Get addresses
vultisig addresses -o json

# 4. Check balances
vultisig balance -o json
```

### Workflow: Send Crypto

```bash
# 1. Check balance
BALANCE=$(vultisig balance ethereum -o json | jq -r '.balance.native')

# 2. Verify sufficient funds
if (( $(echo "$BALANCE > 0.1" | bc -l) )); then
  # 3. Send
  vultisig send ethereum 0xRecipient... 0.1 --password "$VAULT_PASSWORD" -y -o json
fi
```

### Workflow: Cross-Chain Swap

```bash
# 1. Get quote
QUOTE=$(vultisig swap-quote ethereum bitcoin 0.1 -o json)
echo "Expected output: $(echo $QUOTE | jq -r '.expectedOutput') BTC"

# 2. Execute swap
vultisig swap ethereum bitcoin 0.1 --password "$VAULT_PASSWORD" -y -o json
```

### Workflow: Backup Vault

```bash
# Export encrypted backup
vultisig export /backups/ --password "$VAULT_PASSWORD"
```

## Environment Variables

```bash
VULTISIG_VAULT="my-wallet"       # Pre-select vault by name/ID
VAULT_PASSWORD="password"         # Vault password (use with caution)
VULTISIG_SILENT=1                # Suppress spinners/info messages
VULTISIG_NO_COLOR=1              # Disable colored output
```

## Error Handling

| Exit Code | Meaning |
|-----------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid usage |
| 4 | Authentication error |
| 5 | Network error |
| 6 | Vault error |
| 7 | Transaction error |

See [references/errors.md](references/errors.md) for common errors and solutions.

## Supported Chains

36+ blockchains including:
- **EVM**: Ethereum, Polygon, Arbitrum, Optimism, BSC, Base, Avalanche, Blast, Cronos, ZkSync, Hyperliquid, Mantle, Sei
- **UTXO**: Bitcoin, Litecoin, Dogecoin, Bitcoin Cash, Dash, Zcash
- **Cosmos**: Cosmos, THORChain, MayaChain, Osmosis, Dydx, Kujira, Terra, Noble, Akash
- **Other**: Solana, Sui, Polkadot, TON, Ripple, Tron, Cardano

See [references/chains.md](references/chains.md) for full list with details.

## Resources

- [GitHub Repository](https://github.com/vultisig/vultisig-sdk)
- [Full CLI Documentation](https://github.com/vultisig/vultisig-sdk/blob/main/clients/cli/README.md)
- [SDK Documentation](https://github.com/vultisig/vultisig-sdk/blob/main/docs/SDK-USERS-GUIDE.md)
