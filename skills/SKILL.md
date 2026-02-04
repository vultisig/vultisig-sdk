---
name: vultisig
description: MPC wallet for AI agents. Secure multi-chain crypto operations with threshold signing across 36+ blockchains. Routes to CLI (shell commands) or SDK (TypeScript) based on your use case.
version: 1.0.0
author: Vultisig
repository: https://github.com/vultisig/vultisig-sdk
metadata:
  openclaw:
    emoji: "🔐"
    homepage: https://github.com/vultisig/vultisig-sdk
tags:
  - crypto
  - wallet
  - mpc
  - blockchain
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

# Vultisig

Vultisig is an MPC (Multi-Party Computation) wallet that enables secure crypto operations across 36+ blockchains. Unlike traditional wallets, private keys are split across multiple parties using threshold cryptography - there's no single key to steal.

## Why MPC Wallets for AI Agents

Traditional wallets store a single private key or seed phrase. If compromised, all funds are lost. MPC eliminates this risk:

- **No single point of failure**: Keys are split across parties using cryptographic secret sharing
- **Threshold security**: 2-of-2 or N-of-M signing - compromising one party isn't enough
- **No seed phrase exposure**: No mnemonic stored in plaintext anywhere
- **Automation-friendly**: FastVault enables instant server-assisted signing for bots
- **Programmable trust**: Choose speed (FastVault) or maximum security (SecureVault)
- **Audit trail**: All signing requires explicit multi-party coordination

## Choose Your Interface

| Use Case | Interface | Why |
|----------|-----------|-----|
| Shell scripts | [CLI](./vultisig-cli/SKILL.md) | Direct commands, easy scripting |
| Automation bots | [CLI](./vultisig-cli/SKILL.md) | Simple, pipes to jq, env vars |
| One-off operations | [CLI](./vultisig-cli/SKILL.md) | Quick, no code needed |
| TypeScript/Node apps | [SDK](./vultisig-sdk/SKILL.md) | Full API, type safety |
| Custom transaction logic | [SDK](./vultisig-sdk/SKILL.md) | signBytes, broadcastRawTx |
| Browser/React apps | [SDK](./vultisig-sdk/SKILL.md) | Event system, async/await |
| Complex workflows | [SDK](./vultisig-sdk/SKILL.md) | Programmatic control |

### Quick Decision

**Use CLI if**: You're writing shell scripts, need quick commands, or want JSON output piped to other tools.

**Use SDK if**: You're building a TypeScript application, need programmatic control, or want event-driven updates.

## Vault Types

| Type | Threshold | Signing | Best For |
|------|-----------|---------|----------|
| **FastVault** | 2-of-2 (device + server) | Instant (~1-2s) | AI agents, bots, automation |
| **SecureVault** | N-of-M (configurable) | Multi-device coordination | Teams, high-value assets |

**For AI agents, FastVault is recommended** - instant signing without multi-device coordination.

## Supported Chains (36+)

### EVM Chains (13)
Ethereum, Polygon, BSC, Arbitrum, Optimism, Base, Avalanche, Blast, Cronos, zkSync, Hyperliquid, Mantle, Sei

### UTXO Chains (6)
Bitcoin, Litecoin, Dogecoin, Bitcoin Cash, Dash, Zcash

### Cosmos Chains (10)
Cosmos, THORChain, MayaChain, Osmosis, dYdX, Kujira, Terra, Terra Classic, Noble, Akash

### Other Chains (7)
Solana, Sui, Polkadot, TON, Ripple, Tron, Cardano

## Core Operations

Both CLI and SDK support:
- **Create vaults**: FastVault (instant) or SecureVault (multi-device)
- **Import/Export**: Backup and restore vaults
- **Addresses**: Derive addresses for any chain
- **Balances**: Check native and token balances
- **Send**: Transfer crypto to any address
- **Swap**: Cross-chain swaps via THORChain, same-chain via 1inch
- **Sign**: Sign transactions or arbitrary bytes

## Get Started

### CLI Quick Start
```bash
npm install -g @vultisig/cli
vultisig create fast --name "bot-wallet" --email "bot@example.com" --password "SecurePass123!"
vultisig balance -o json
```
→ [Full CLI Documentation](./vultisig-cli/SKILL.md)

### SDK Quick Start
```typescript
import { Vultisig, Chain } from '@vultisig/sdk'

const sdk = new Vultisig()
await sdk.initialize()

const vaultId = await sdk.createFastVault({
  name: 'bot-wallet',
  email: 'bot@example.com',
  password: 'SecurePass123!'
})
const vault = await sdk.verifyVault(vaultId, 'email-code')
const balance = await vault.balance(Chain.Ethereum)
```
→ [Full SDK Documentation](./vultisig-sdk/SKILL.md)

## Resources

- [GitHub Repository](https://github.com/vultisig/vultisig-sdk)
- [CLI Documentation](./vultisig-cli/SKILL.md)
- [SDK Documentation](./vultisig-sdk/SKILL.md)
