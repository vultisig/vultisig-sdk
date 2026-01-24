# Vultisig CLI

Command-line wallet for Vultisig - secure multi-party computation (MPC) wallet management across 40+ blockchains.

> **Tip:** Use `vsig` as a shorthand alias for `vultisig` - all commands work with both!

## Installation

### npm (recommended)

```bash
# Install globally
npm install -g @vultisig/cli

# Verify installation
vultisig --version
```

### npx (no installation)

```bash
# Run directly without installing
npx @vultisig/cli balance ethereum
```

### From source

```bash
# Clone the repository
git clone https://github.com/vultisig/vultisig-sdk.git
cd vultisig-sdk

# Install dependencies
yarn install

# Run CLI
yarn cli --help
```

## Shell Completion

Enable tab completion for commands, chains, and vault names (works for both `vultisig` and `vsig`):

```bash
# Install completion for your shell
vultisig completion --install

# Or manually add to your shell config
vultisig completion bash >> ~/.bashrc
vultisig completion zsh >> ~/.zshrc
vultisig completion fish >> ~/.config/fish/completions/vultisig.fish
```

## Quick Start

### Create a Fast Vault

```bash
vultisig create fast --name "My Wallet" --password "mypassword" --email user@example.com
```

You'll be prompted to:
1. Enter the verification code sent to your email

### Create a Secure Vault (Multi-Device)

```bash
vultisig create secure --name "Team Wallet" --shares 3
```

This creates a secure vault with configurable N-of-M threshold:
1. A QR code displays in your terminal
2. Other participants scan with Vultisig mobile app (iOS/Android)
3. Once all devices join, keygen runs automatically
4. Vault is created and ready to use

**Secure vault options:**
- `--shares <n>` - Number of participating devices (default: 3)
- `--threshold <n>` - Signing threshold (default: 2)

**Example session:**
```bash
$ vultisig create secure --name "Team Wallet" --shares 3

Creating secure vault: Team Wallet (2-of-3)

Scan this QR code with Vultisig mobile app:
████████████████████████████
█ ▄▄▄▄▄ █▀ ▄█▄█▀█ ▄▄▄▄▄ █
█ █   █ █▀▄▄▄ ▄██ █   █ █
...

Waiting for devices to join...
⠋ Device joined: iPhone-abc123 (2/3)
⠋ Device joined: Android-def456 (3/3)

All devices joined. Running keygen...
✓ ECDSA keygen complete
✓ EdDSA keygen complete

✓ Secure vault created: Team Wallet
  Vault ID: vault_abc123def456
```

### Import from Seedphrase

Import an existing wallet from a BIP39 recovery phrase (12 or 24 words):

```bash
# FastVault import (server-assisted 2-of-2)
vultisig create-from-seedphrase fast --name "Imported Wallet" --email user@example.com

# SecureVault import (multi-device MPC)
vultisig create-from-seedphrase secure --name "Team Wallet" --shares 3
```

**Import options:**
- `--mnemonic <words>` - Recovery phrase (space-separated words)
- `--discover-chains` - Scan chains for existing balances before import
- `--chains <chains>` - Specific chains to enable (comma-separated)

When `--mnemonic` is not provided, you'll be prompted to enter it securely (masked input).

**Example session:**
```bash
$ vultisig create-from-seedphrase fast --name "My Wallet" --email user@example.com --discover-chains

Enter your 12 or 24-word recovery phrase.
Words will be hidden as you type.

Seedphrase: ************************
Password: ********
✓ Valid 12-word seedphrase

Discovering chains with balances...
  Bitcoin:     bc1q...xyz     0.05 BTC
  Ethereum:    0x1234...      1.2 ETH
✓ Found 2 chains with balances

Importing seedphrase... (35%)
✓ Keys generated, awaiting email verification

Enter verification code: 123456
✓ Vault verified successfully!

Vault imported: My Wallet
  Bitcoin:  bc1q...xyz
  Ethereum: 0x1234...abc
```

### Check Balances

```bash
# All chains
vultisig balance

# Specific chain
vultisig balance ethereum

# Include token balances
vultisig balance ethereum --tokens
```

### Send Transaction

```bash
# Send native token
vultisig send ethereum 0xRecipient... 0.1

# Send ERC-20 token
vultisig send ethereum 0xRecipient... 100 --token 0xTokenAddress...

# Provide password via flag (for scripts/automation)
vultisig send ethereum 0xRecipient... 0.1 --password mypassword
```

**Secure vault transactions:**

When using a secure vault, a QR code displays for device coordination:

```bash
$ vultisig send ethereum 0x742d35Cc... 0.1

Preparing transaction...

Scan this QR code to approve transaction:
████████████████████████████
...

Waiting for devices to join signing session...
⠋ Device joined: iPhone-abc123 (2/2)

Signing transaction...
✓ Transaction signed
✓ Broadcast: 0x9f8e7d6c...
```

You can cancel with Ctrl+C while waiting for devices.

### Interactive Shell

Start an interactive session with tab completion and password caching:

```bash
vultisig --interactive
# or
vultisig -i
```

## Commands

### Vault Management

| Command | Description |
|---------|-------------|
| `create fast` | Create a new fast vault (server-assisted 2-of-2) |
| `create secure` | Create a secure vault (multi-device MPC) |
| `import <file>` | Import vault from .vult file |
| `create-from-seedphrase fast` | Import seedphrase as FastVault (2-of-2) |
| `create-from-seedphrase secure` | Import seedphrase as SecureVault (N-of-M) |
| `join secure` | Join an existing SecureVault creation session |
| `export [path]` | Export vault to file |
| `verify <vaultId>` | Verify vault with email code |
| `vaults` | List all stored vaults |
| `switch <vaultId>` | Switch to a different vault |
| `rename <newName>` | Rename the active vault |
| `info` | Show detailed vault information |

**Create fast options:**
- `--name <name>` - Vault name (required)
- `--password <password>` - Vault password (required)
- `--email <email>` - Email for verification (required)

**Create secure options:**
- `--name <name>` - Vault name (required)
- `--password <password>` - Vault password (optional)
- `--shares <n>` - Number of devices (default: 3)
- `--threshold <n>` - Signing threshold (default: 2)

**Join secure options:**
- `--qr <payload>` - QR code payload from initiator (vultisig://...)
- `--qr-file <path>` - Read QR payload from file
- `--mnemonic <words>` - Seedphrase (required for seedphrase-based sessions)
- `--password <password>` - Vault password (optional)
- `--devices <n>` - Total devices in session (default: 2)

**Create-from-seedphrase fast options:**
- `--name <name>` - Vault name (required)
- `--email <email>` - Email for verification (required)
- `--password <password>` - Vault password (required)
- `--mnemonic <words>` - Recovery phrase (prompted securely if not provided)
- `--discover-chains` - Auto-enable chains with existing balances
- `--chains <chains>` - Specific chains to enable (comma-separated)

**Create-from-seedphrase secure options:**
- `--name <name>` - Vault name (required)
- `--shares <n>` - Number of devices (default: 2)
- `--threshold <n>` - Signing threshold (default: ceil((shares+1)/2))
- `--password <password>` - Vault password (optional)
- `--mnemonic <words>` - Recovery phrase (prompted securely if not provided)
- `--discover-chains` - Auto-enable chains with existing balances
- `--chains <chains>` - Specific chains to enable (comma-separated)

**Export options:**
- `[path]` - Output file or directory (defaults to SDK-generated filename in current directory)
- `--password <password>` - Password to unlock encrypted vaults
- `--exportPassword <password>` - Password to encrypt the export file (defaults to `--password` if provided)

```bash
# Export to current directory (prompts for export password)
vultisig export

# Export to specific directory
vultisig export /path/to/backups/

# Export with encryption (same password for unlock and export)
vultisig export --password mypassword

# Export with different passwords for unlock vs export
vultisig export --password unlockPass --exportPassword exportPass

# Export without encryption (leave password prompt empty)
vultisig export
# > Enter password for export encryption (leave empty for no encryption): [enter]
```

### Wallet Operations

| Command | Description |
|---------|-------------|
| `balance [chain]` | Show balance for a chain or all chains |
| `send <chain> <to> <amount>` | Send tokens to an address |
| `addresses` | Show all vault addresses |
| `portfolio` | Show total portfolio value |

### Chain & Token Management

| Command | Description |
|---------|-------------|
| `chains` | List and manage chains (--add, --remove) |
| `tokens <chain>` | List and manage tokens for a chain |

### Swap Operations

| Command | Description |
|---------|-------------|
| `swap-chains` | List chains that support swaps |
| `swap-quote <from> <to> <amount>` | Get a swap quote |
| `swap <from> <to> <amount>` | Execute a swap |

```bash
# Execute a swap
vultisig swap ethereum bitcoin 0.1

# With password for automation
vultisig swap ethereum bitcoin 0.1 --password mypassword

# Skip confirmation prompt
vultisig swap ethereum bitcoin 0.1 -y --password mypassword
```

### Advanced Operations

| Command | Description |
|---------|-------------|
| `sign` | Sign pre-hashed bytes for custom transactions |
| `broadcast` | Broadcast a pre-signed raw transaction |

#### Signing Arbitrary Bytes

Sign pre-hashed data for externally constructed transactions:

```bash
# Sign a pre-hashed message (base64 encoded)
vultisig sign --chain ethereum --bytes "aGVsbG8gd29ybGQ="

# With password
vultisig sign --chain bitcoin --bytes "..." --password mypassword

# JSON output
vultisig sign --chain ethereum --bytes "..." -o json
```

**Output:**
```
Signature: <base64-encoded signature>
Recovery: 0
Format: ecdsa
```

**JSON output:**
```json
{
  "signature": "<base64>",
  "recovery": 0,
  "format": "ecdsa"
}
```

#### Broadcasting Raw Transactions

Broadcast pre-signed transactions to the network:

```bash
# EVM transaction (hex)
vultisig broadcast --chain ethereum --raw-tx "0x02f8..."

# Bitcoin transaction (hex)
vultisig broadcast --chain bitcoin --raw-tx "0200000001..."

# Solana transaction (base64)
vultisig broadcast --chain solana --raw-tx "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQABAwIAAA..."

# Sui transaction (JSON)
vultisig broadcast --chain sui --raw-tx '{"unsignedTx":"...","signature":"..."}'
```

**Output:**
```
TX Hash: 0x9f8e7d6c...
Explorer: https://etherscan.io/tx/0x9f8e7d6c...
```

**Supported broadcast formats by chain:**

| Chain | `--raw-tx` Format |
|-------|-------------------|
| EVM (Ethereum, Polygon, etc.) | Hex-encoded signed tx |
| UTXO (Bitcoin, Litecoin, etc.) | Hex-encoded raw tx |
| Solana | Base64-encoded tx bytes |
| Sui | JSON: `{"unsignedTx":"...","signature":"..."}` |
| Cosmos | JSON: `{"tx_bytes":"..."}` or base64 |
| TON | Base64 BOC |
| Polkadot | Hex-encoded extrinsic |
| Ripple | Hex-encoded tx blob |
| Tron | JSON tx object |

#### Example: Custom EVM Transaction

Build and sign a transaction with ethers.js, broadcast with CLI:

```bash
# 1. Build transaction externally (save as build-evm-tx.js)
cat > build-evm-tx.js << 'EOF'
const { keccak256, Transaction, parseEther } = require('ethers');
const tx = Transaction.from({
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
  value: parseEther('0.01'),
  gasLimit: 21000n,
  maxFeePerGas: 50000000000n,
  maxPriorityFeePerGas: 2000000000n,
  nonce: 0,
  chainId: 1,
  type: 2
});
const hash = keccak256(tx.unsignedSerialized);
console.log('HASH:', Buffer.from(hash.slice(2), 'hex').toString('base64'));
console.log('UNSIGNED:', tx.unsignedSerialized);
EOF
node build-evm-tx.js

# 2. Sign the hash with Vultisig
vultisig sign --chain ethereum --bytes "<base64-hash-from-step-1>" -o json > sig.json

# 3. Assemble signed transaction (use r,s,v from sig.json)
# The signature field contains r||s (64 bytes hex), recovery is v

# 4. Broadcast the assembled signed transaction
vultisig broadcast --chain ethereum --raw-tx "0x02f8..."
```

#### Example: Custom Bitcoin Transaction

Build a PSBT with bitcoinjs-lib, sign with CLI:

```bash
# 1. Build PSBT and get sighash (save as build-btc-tx.js)
cat > build-btc-tx.js << 'EOF'
const bitcoin = require('bitcoinjs-lib');
const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
// Add your inputs and outputs
psbt.addInput({
  hash: '<previous-txid>',
  index: 0,
  witnessUtxo: { script: Buffer.from('...'), value: 100000 }
});
psbt.addOutput({ address: 'bc1q...', value: 90000 });
// Get sighash for signing
const sighash = psbt.getTxForSigning().hashForWitnessV0(0, scriptCode, 100000, 0x01);
console.log('SIGHASH:', sighash.toString('base64'));
EOF
node build-btc-tx.js

# 2. Sign with Vultisig
vultisig sign --chain bitcoin --bytes "<base64-sighash>" -o json > sig.json

# 3. Apply signature to PSBT and finalize (use signature from sig.json)

# 4. Broadcast
vultisig broadcast --chain bitcoin --raw-tx "0200000001..."
```

#### Example: Custom Solana Transaction

Build with @solana/web3.js, sign with CLI:

```bash
# 1. Build transaction (save as build-sol-tx.js)
cat > build-sol-tx.js << 'EOF'
const { Transaction, SystemProgram, PublicKey, Connection } = require('@solana/web3.js');
const connection = new Connection('https://api.mainnet-beta.solana.com');
const fromPubkey = new PublicKey('<your-pubkey>');
const toPubkey = new PublicKey('<recipient-pubkey>');

const tx = new Transaction().add(
  SystemProgram.transfer({ fromPubkey, toPubkey, lamports: 1000000 })
);
tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
tx.feePayer = fromPubkey;

const message = tx.serializeMessage();
console.log('MESSAGE:', message.toString('base64'));
EOF
node build-sol-tx.js

# 2. Sign the message with Vultisig (EdDSA)
vultisig sign --chain solana --bytes "<base64-message>" -o json > sig.json

# 3. Assemble signed transaction (attach signature to message)

# 4. Broadcast (base64 encoded signed transaction)
vultisig broadcast --chain solana --raw-tx "<base64-signed-tx>"
```

#### Example: Custom Sui Transaction

Build with @mysten/sui, sign with CLI:

```bash
# 1. Build transaction (save as build-sui-tx.js)
cat > build-sui-tx.js << 'EOF'
const { SuiClient, getFullnodeUrl } = require('@mysten/sui/client');
const { Transaction } = require('@mysten/sui/transactions');

const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
const tx = new Transaction();
tx.transferObjects([tx.gas], '<recipient-address>');
const bytes = await tx.build({ client });
console.log('TX_BYTES:', Buffer.from(bytes).toString('base64'));
EOF
node build-sui-tx.js

# 2. Sign the transaction bytes with Vultisig (EdDSA)
vultisig sign --chain sui --bytes "<base64-tx-bytes>" -o json > sig.json

# 3. Broadcast (requires JSON with both unsigned tx and signature)
vultisig broadcast --chain sui --raw-tx '{"unsignedTx":"<base64-tx-bytes>","signature":"<base64-signature-from-sig.json>"}'
```

### Settings

| Command | Description |
|---------|-------------|
| `currency [code]` | View or set currency preference |
| `server` | Check server connectivity |
| `address-book` | Manage saved addresses |

### CLI Management

| Command | Description |
|---------|-------------|
| `version` | Show detailed version info |
| `update` | Check for updates |
| `completion` | Generate shell completion |

### Interactive Shell Commands

| Command | Description |
|---------|-------------|
| `vault <name>` | Switch to a different vault |
| `vaults` | List all vaults |
| `create` | Create a new vault |
| `import <file>` | Import vault from file |
| `lock` | Lock vault (clear cached password) |
| `unlock` | Unlock vault (cache password) |
| `status` | Show vault status |
| `help` | Show available commands |
| `.clear` | Clear the screen |
| `.exit` | Exit the shell |

## Global Options

```
-v, --version            Show version
-i, --interactive        Start interactive shell mode
-o, --output <format>    Output format: table, json (default: table)
--vault <nameOrId>       Specify vault by name or ID
--silent                 Suppress informational output, show only results
--debug                  Enable debug output
-h, --help               Show help
```

### Silent Mode

Use `--silent` to suppress spinners, progress messages, and informational output. Only results and errors are shown:

```bash
# Normal output shows spinners and status messages
vultisig balance ethereum
# ✓ Loading vault...
# ✓ Fetching balance...
# ETH: 1.5

# Silent mode shows only the result
vultisig balance ethereum --silent
# ETH: 1.5
```

Silent mode is useful for scripts where you only want the final output.

### JSON Output

Use `-o json` or `--output json` to get structured JSON output. JSON mode automatically enables silent mode:

```bash
# Get balance as JSON
vultisig balance ethereum -o json
```
```json
{
  "chain": "ethereum",
  "balance": {
    "native": "1.5",
    "symbol": "ETH",
    "usdValue": "3750.00"
  }
}
```

```bash
# Get all balances as JSON
vultisig balance -o json
```
```json
{
  "balances": [
    { "chain": "ethereum", "native": "1.5", "symbol": "ETH", "usdValue": "3750.00" },
    { "chain": "bitcoin", "native": "0.1", "symbol": "BTC", "usdValue": "6500.00" }
  ]
}
```

```bash
# Get portfolio as JSON
vultisig portfolio -o json
```
```json
{
  "portfolio": {
    "totalUsdValue": "10250.00",
    "chains": [...]
  },
  "currency": "USD"
}
```

```bash
# List vaults as JSON
vultisig vaults -o json
```
```json
{
  "vaults": [
    { "id": "abc123", "name": "Main Wallet", "isActive": true }
  ],
  "activeVaultId": "abc123"
}
```

```bash
# Get swap quote as JSON
vultisig swap-quote ethereum thorchain 0.1 -o json
```
```json
{
  "quote": {
    "fromChain": "ethereum",
    "toChain": "thorchain",
    "fromAmount": "0.1",
    "expectedOutput": "125.5",
    "route": "..."
  }
}
```

JSON output is ideal for:
- Scripting and automation
- Parsing output programmatically
- Integration with other tools (e.g., `jq`):

```bash
# Extract just the ETH balance using jq
vultisig balance ethereum -o json | jq -r '.balance.native'

# Get total portfolio value
vultisig portfolio -o json | jq -r '.portfolio.totalUsdValue'
```

## Configuration

### Environment Variables

```bash
# Pre-select vault by name or ID
VULTISIG_VAULT=MyWallet

# Override config directory
VULTISIG_CONFIG_DIR=/custom/path

# Disable colored output
VULTISIG_NO_COLOR=1

# Enable silent mode (suppress spinners and info messages)
VULTISIG_SILENT=1

# Enable debug output
VULTISIG_DEBUG=1

# Disable update checking
VULTISIG_NO_UPDATE_CHECK=1

# Vault password (for automation - use with caution!)
VAULT_PASSWORD=mypassword

# Multiple vault passwords
VAULT_PASSWORDS="Vault1:pass1 Vault2:pass2"
```

### Config Directory

Configuration is stored in `~/.vultisig/`:

```
~/.vultisig/
├── config.json      # User preferences
├── vaults/          # Vault data
├── cache/           # Version checks, etc.
└── address-book.json
```

## Security Best Practices

- Never store passwords in plain text for production use
- Always verify transaction details before confirming
- Use testnets for development and testing
- Keep vault backup files in a secure location
- Never commit .vult files or .env with passwords to git

## Supported Chains

40+ blockchains including:
- **EVM**: Ethereum, Polygon, Arbitrum, Optimism, BSC, Base, Avalanche
- **UTXO**: Bitcoin, Litecoin, Dogecoin, Dash, Zcash
- **Cosmos**: Cosmos Hub, THORChain, Maya, Dydx, Kujira
- **Others**: Solana, Sui, Polkadot, Ripple

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid usage |
| 3 | Configuration error |
| 4 | Authentication error |
| 5 | Network error |
| 6 | Vault error |
| 7 | Transaction error |

## Troubleshooting

### "No active vault" error

Create or import a vault first:
```bash
vultisig create fast --name "My Wallet" --password "mypassword" --email user@example.com
# or
vultisig import /path/to/vault.vult
```

### Network errors

1. Check your internet connection
2. Run `vultisig server` to check connectivity
3. Try again in a few moments

### Update issues

```bash
# Check for updates
vultisig update --check

# Update manually
npm update -g @vultisig/cli
```

## Documentation

- [SDK Documentation](../../packages/sdk/README.md)
- [API Reference](https://docs.vultisig.com)

## Support

- [GitHub Issues](https://github.com/vultisig/vultisig-sdk/issues)
- [Discord](https://discord.gg/vultisig)
- [Documentation](https://docs.vultisig.com)

## License

MIT
