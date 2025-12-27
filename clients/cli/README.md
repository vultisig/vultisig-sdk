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
vultisig create
```

You'll be prompted to:
1. Enter a vault name
2. Set a password (min 8 characters)
3. Provide an email for verification
4. Enter the verification code sent to your email

### Create a Secure Vault (Multi-Device)

```bash
vultisig create --secure --name "Team Wallet" --shares 3
```

This creates a secure vault with configurable N-of-M threshold:
1. A QR code displays in your terminal
2. Other participants scan with Vultisig mobile app (iOS/Android)
3. Once all devices join, keygen runs automatically
4. Vault is created and ready to use

**Secure vault options:**
- `--shares <n>` - Number of participating devices (default: 2)
- `--threshold <n>` - Signing threshold (default: ceil((shares+1)/2))

**Example session:**
```bash
$ vultisig create --secure --name "Team Wallet" --shares 3

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
| `create` | Create a new fast vault (server-assisted) |
| `create --secure` | Create a secure vault (multi-device MPC) |
| `import <file>` | Import vault from .vult file |
| `export [path]` | Export vault to file |
| `verify <vaultId>` | Verify vault with email code |
| `vaults` | List all stored vaults |
| `switch <vaultId>` | Switch to a different vault |
| `rename <newName>` | Rename the active vault |
| `info` | Show detailed vault information |

**Create options:**
- `--secure` - Create a secure vault instead of fast vault
- `--name <name>` - Vault name
- `--shares <n>` - Number of devices for secure vault (default: 2)
- `--threshold <n>` - Signing threshold (default: ceil((shares+1)/2))

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
vultisig create
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
