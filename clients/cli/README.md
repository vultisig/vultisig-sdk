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

### Create a Vault

```bash
vultisig create
```

You'll be prompted to:
1. Enter a vault name
2. Set a password (min 8 characters)
3. Provide an email for verification
4. Enter the verification code sent to your email

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
```

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
| `create` | Create a new vault |
| `import <file>` | Import vault from .vult file |
| `export [path]` | Export vault to file |
| `verify <vaultId>` | Verify vault with email code |
| `vaults` | List all stored vaults |
| `switch <vaultId>` | Switch to a different vault |
| `rename <newName>` | Rename the active vault |
| `info` | Show detailed vault information |

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
| `lock` | Lock vault (clear cached password) |
| `unlock` | Unlock vault (cache password) |
| `status` | Show vault status |
| `help` | Show available commands |
| `.exit` | Exit the shell |

## Global Options

```
-v, --version      Show version
-i, --interactive  Start interactive shell mode
--debug            Enable debug output
-h, --help         Show help
```

## Configuration

### Environment Variables

```bash
# Override config directory
VULTISIG_CONFIG_DIR=/custom/path

# Disable colored output
VULTISIG_NO_COLOR=1

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
