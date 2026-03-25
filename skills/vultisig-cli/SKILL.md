---
name: vultisig-cli
description: MPC wallet CLI for secure multi-chain crypto operations across 36+ blockchains. Use when the user wants to create MPC wallets, send crypto, swap tokens cross-chain, check balances, sign transactions, or manage multi-signature vaults. Supports Bitcoin, Ethereum, Solana, and 33+ other chains with threshold signing security.
version: 1.0.0
author: Vultisig
repository: https://github.com/vultisig/vultisig-sdk
metadata:
  openclaw:
    emoji: "🔐"
    homepage: https://github.com/vultisig/vultisig-sdk
    requires:
      bins:
        - vultisig
    install:
      npm: "@vultisig/cli"
tags:
  - crypto
  - wallet
  - mpc
  - cli
  - defi
  - bitcoin
  - ethereum
  - solana
---

# Vultisig CLI

Command-line interface for Vultisig MPC wallet operations. See the [router skill](../SKILL.md) for an overview of MPC benefits and to choose between CLI and SDK.

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

See [references/vault-types.md](references/vault-types.md) for detailed comparison including key shares explanation.

## Understanding Vault Shares (MPC Key Shares)

Vultisig uses Multi-Party Computation (MPC) to split private keys into **shares**. No single party ever holds the complete private key.

**FastVault (2-of-2):**
- **Share 1**: Stored on your device, encrypted with your vault password (in a `.vult` file)
- **Share 2**: Stored on VultiServer
- Both shares must cooperate to sign a transaction. The server never sees your share, you never see theirs.
- Each share contains ECDSA, EdDSA, and ML-DSA (post-quantum) key material.

**SecureVault (N-of-M):**
- Shares are distributed across M devices (phones, laptops, etc.)
- Any N shares can cooperate to sign (e.g., 2-of-3 means any 2 of 3 devices)
- No server involved — coordination happens via a relay that never sees key material.

**What to tell users:** "Your vault uses threshold signing. Your private key is split into shares — no single device or server holds the full key. Signing requires cooperation between share holders."

See [references/vault-types.md](references/vault-types.md) for full details on key shares.

## Quick Start (Agent-Friendly, Non-Interactive)

FastVault creation requires email verification. Use `--two-step` for a fully non-interactive flow (or the CLI auto-detects non-TTY environments and enables it automatically).

### 1. Create a FastVault

```bash
vultisig create fast \
  --name "agent-wallet" \
  --email "agent@example.com" \
  --password "SecurePass123!" \
  --two-step \
  -o json
```

Returns:
```json
{
  "vaultId": "abc123-def456",
  "status": "pending_verification",
  "message": "Vault created. Verify with email OTP to activate.",
  "verifyCommand": "vultisig verify abc123-def456 --code <OTP>",
  "resendCommand": "vultisig verify abc123-def456 --resend --email agent@example.com --password <password>"
}
```

### 2. Verify with Email OTP

The user receives a 4-6 digit code by email. Verify non-interactively:

```bash
vultisig verify abc123-def456 --code 123456 -o json
```

Returns:
```json
{"verified": true, "vault": {"id": "abc123-def456", "name": "agent-wallet", "type": "fast"}}
```

To resend the verification email:
```bash
vultisig verify abc123-def456 --resend --email "agent@example.com" --password "SecurePass123!"
```

### 3. Get Addresses

```bash
vultisig addresses -o json
```

### 4. Check Balance

```bash
vultisig balance ethereum -o json
vultisig balance --tokens -o json  # Include ERC-20 tokens
```

### 5. Send Transaction

```bash
vultisig send ethereum 0xRecipient... 0.1 --password "SecurePass123!" -y -o json
```

### 6. Swap Tokens

```bash
vultisig swap-quote ethereum bitcoin 0.1 -o json
vultisig swap ethereum bitcoin 0.1 --password "SecurePass123!" -y -o json
```

## Core Commands

### Vault Management

| Command | Description |
|---------|-------------|
| `create fast --name --email --password [--two-step]` | Create FastVault (server-assisted 2-of-2). Use `--two-step` for non-interactive mode |
| `create secure --name --shares N` | Create SecureVault (multi-device N-of-M) |
| `verify <vaultId> --code <code>` | Verify vault with email OTP (non-interactive) |
| `verify <vaultId>` | Verify vault (interactive prompt for code) |
| `verify <vaultId> --resend --email <email> --password <pass>` | Resend verification email |
| `vaults -o json` | List all vaults |
| `switch <vaultId>` | Switch active vault |
| `info -o json` | Show vault details (includes vault type, chains, addresses) |
| `import <file.vult>` | Import vault from backup |
| `export [path]` | Export vault backup |
| `delete [vault] -y` | Delete vault |

### Wallet Operations

| Command | Description |
|---------|-------------|
| `addresses -o json` | Get all addresses |
| `balance [chain] -o json` | Get balance (optional: specific chain) |
| `balance --tokens -o json` | Include token balances |
| `portfolio -o json` | Total portfolio value in fiat |
| `portfolio --currency EUR -o json` | Portfolio in specific currency |
| `send <chain> <to> <amount>` | Send native token |
| `send <chain> <to> <amount> --token <addr>` | Send ERC-20/SPL token |

### Swap Operations

| Command | Description |
|---------|-------------|
| `swap-chains` | List chains supporting swaps |
| `swap-quote <from> <to> <amount>` | Get swap quote |
| `swap <from> <to> <amount>` | Execute swap |

### Rujira / THORChain Secured Assets

Secured assets are L1 assets (BTC, ETH, etc.) deposited to THORChain, backed 1:1 on the native chain, and tradeable on THORChain's FIN DEX.

| Command | Description |
|---------|-------------|
| `rujira balance -o json` | Show secured asset balances on THORChain |
| `rujira balance --secured-only -o json` | Filter to secured/FIN denoms only |
| `rujira routes -o json` | List available FIN swap routes |
| `rujira deposit --asset BTC.BTC --amount 100000` | Get deposit instructions (inbound address + memo) |
| `rujira swap --from-asset THOR.RUNE --to-asset ETH.ETH --amount 100 -y` | Execute FIN swap |
| `rujira withdraw --asset BTC.BTC --amount 100000 --l1-address bc1q... -y` | Withdraw secured assets to L1 |

Asset naming: `BTC.BTC`, `ETH.ETH`, `ETH.USDC-0xa0b8...`, `THOR.RUNE`

See [references/rujira.md](references/rujira.md) for detailed Rujira/secured assets guide.

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
# Balance (single chain)
vultisig balance ethereum -o json
# {"chain":"ethereum","balance":{"native":"1.5","symbol":"ETH","usdValue":"3750.00"}}

# Balance (all chains)
vultisig balance -o json
# {"balances":[{"chain":"ethereum","balance":{"native":"1.5","symbol":"ETH","usdValue":"3750.00"}},{"chain":"bitcoin","balance":{"native":"0.1","symbol":"BTC","usdValue":"6500.00"}}]}

# Portfolio (total fiat value)
vultisig portfolio -o json
# {"portfolio":{"totalUsdValue":"10250.00","chains":[{"chain":"ethereum","balance":{"native":"1.5","symbol":"ETH","usdValue":"3750.00"}},{"chain":"bitcoin","balance":{"native":"0.1","symbol":"BTC","usdValue":"6500.00"}}]},"currency":"USD"}

# Send transaction
vultisig send ethereum 0x... 0.1 -y --password "pass" -o json
# {"txHash":"0x...","chain":"ethereum","explorerUrl":"https://etherscan.io/tx/0x..."}

# Vault info
vultisig info -o json
# {"vault":{"id":"...","name":"...","type":"fast","chains":[...]}}

# Create vault (two-step)
vultisig create fast --name "w" --email "e@e.com" --password "p" --two-step -o json
# {"vaultId":"...","status":"pending_verification","verifyCommand":"vultisig verify ... --code <OTP>"}

# Verify vault
vultisig verify <id> --code 123456 -o json
# {"verified":true,"vault":{"id":"...","name":"...","type":"fast"}}
```

## Common Workflows

### Workflow: First-Time Setup (Non-Interactive)

```bash
# 1. Create vault (non-interactive, returns vault ID)
RESULT=$(vultisig create fast --name "agent-wallet" --email "agent@example.com" --password "SecurePass123!" --two-step -o json)
VAULT_ID=$(echo "$RESULT" | jq -r '.vaultId')

# 2. User retrieves OTP from email, then verify
vultisig verify "$VAULT_ID" --code 123456 -o json

# 3. Enable desired chains
vultisig chains --add-all

# 4. Get addresses
vultisig addresses -o json

# 5. Check balances
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
