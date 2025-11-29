# Vultisig CLI Wallet

A complete command-line wallet application demonstrating the Vultisig SDK.

## What's New 🆕

This example has been updated to showcase the latest Vultisig SDK features:

- **🔑 Optional Password Storage**: Configure passwords in .env for automation or get prompted interactively
- **⚙️ Instance-Scoped Configuration**: SDK initialization with explicit dependency injection (no global singletons)
- **🎯 Smart Password Resolution**: Automatic password lookup from environment or prompt user
- **🏗️ Polymorphic Vaults**: Type-safe vault operations with FastVault and SecureVault classes
- **🚀 CLI-Optimized**: No unnecessary caching - each command runs independently

### Migration from Previous Versions

The SDK uses instance-scoped configuration:

- Import from `@vultisig/sdk/node` for Node.js applications
- Pass `storage: new FileStorage()` to the Vultisig constructor
- Pass `onPasswordRequired` callback directly to the Vultisig constructor
- Sign operations no longer require password parameter (resolved automatically)
- Call `sdk.dispose()` for cleanup when done

## Features

- 🔐 Secure vault creation and management
- 🌍 Multi-chain support (40+ blockchains)
- 💰 Balance checking and portfolio tracking
- 💸 Transaction signing and broadcasting
- 📊 Fiat value tracking
- 🎯 Event-driven architecture
- 🛡️ Production-ready error handling
- 🔑 Optional password storage for automation

## Quick Start

### Installation

```bash
# Install dependencies
yarn install

# Or using npm
npm install
```

### Create a Vault

```bash
npm run wallet create
```

You'll be prompted to:

1. Enter a vault name
2. Set a password (min 8 characters)
3. Provide an email for verification
4. Enter the verification code sent to your email

### Check Balances

```bash
# View all balances
npm run wallet balance

# View balance for a specific chain
npm run wallet balance Ethereum

# Include token balances
npm run wallet balance Ethereum --tokens
```

### View Addresses

```bash
npm run wallet addresses
```

### Send a Transaction

```bash
# Send native token
npm run wallet send Ethereum 0xRecipient... 0.1

# Send ERC-20 token
npm run wallet send Ethereum 0xRecipient... 100 --token 0xTokenAddress...

# Send with memo
npm run wallet send Cosmos cosmos1recipient... 10 --memo "Payment for services"
```

## Available Commands

| Command                      | Description                                           |
| ---------------------------- | ----------------------------------------------------- |
| `create`                     | Create a new vault                                    |
| `import <file>`              | Import vault from .vult file                          |
| `verify <vaultId>`           | Verify vault with email code (use --resend to resend) |
| `balance [chain]`            | Show balances for all chains or a specific chain      |
| `send <chain> <to> <amount>` | Send transaction                                      |
| `portfolio`                  | Show total portfolio value                            |
| `export [path]`              | Export vault to file                                  |
| `addresses`                  | Show all vault addresses                              |
| `chains`                     | List chains (use --add or --remove to manage)         |

## Configuration

Create a `.env` file (see `.env.example`):

```bash
# Copy the example file
cp .env.example .env
```

Available configuration options:

```bash
VULTISIG_SERVER_URL=https://api.vultisig.com/vault
VULTISIG_RELAY_URL=https://api.vultisig.com/router
DEFAULT_CURRENCY=USD
VAULT_STORAGE_PATH=./vaults
USE_TESTNET=true  # Recommended for development

# Optional: Store vault passwords (use with caution!)
# Single vault (any vault will use this password)
VAULT_PASSWORD=mypassword

# Multiple vaults (space-separated "name:password" pairs)
VAULT_PASSWORDS=MyVault:pass123 WorkVault:pass456
```

**Security Note**: Storing passwords in `.env` is convenient for development and automation but less secure. For production use, omit these variables and the CLI will prompt you for passwords interactively.

## Examples

### Complete Transaction Flow

```bash
# 1. Create vault
npm run wallet create

# 2. View your addresses
npm run wallet addresses

# 3. Fund your wallet (using a faucet for testnet)
# Visit https://sepoliafaucet.com for Sepolia testnet ETH

# 4. Check balance
npm run wallet balance Ethereum

# 5. Send transaction
npm run wallet send Ethereum 0xRecipient... 0.01

# 6. Check portfolio value
npm run wallet portfolio
```

### Multi-Chain Support

```bash
# Add a new chain
npm run wallet chains --add Arbitrum

# View all active chains
npm run wallet chains

# Check balance on new chain
npm run wallet balance Arbitrum

# Remove a chain
npm run wallet chains --remove Arbitrum
```

### Import/Export Vaults

```bash
# Export vault for backup
npm run wallet export

# Export to specific path
npm run wallet export ./backups/my-vault.vult

# Import vault
npm run wallet import ./backups/my-vault.vult
```

### Portfolio Value

```bash
# View portfolio in USD
npm run wallet portfolio

# View in different currency
npm run wallet portfolio --currency EUR
npm run wallet portfolio --currency GBP
```

## Architecture

This example demonstrates:

### Vault Lifecycle

- **Create**: Generate a new fast vault with email verification
- **Import**: Load an existing vault from a .vult file
- **Export**: Backup your vault to an encrypted file
- **Verify**: Confirm vault creation via email

### Multi-Chain Operations

- **40+ Blockchains**: Support for EVM, UTXO, Cosmos, and more
- **Address Derivation**: Automatic address generation for all chains
- **Balance Tracking**: Real-time balance updates with caching
- **Gas Estimation**: Automatic fee calculation

### Transaction Flow

1. **Prepare**: Build transaction payload with proper formatting
2. **Preview**: Show transaction details and gas estimates
3. **Confirm**: User confirmation before signing
4. **Sign**: MPC-based signing with progress tracking
5. **Broadcast**: Submit to blockchain and get transaction hash
6. **Track**: Generate explorer URLs for verification

### Event System

- **Progress Tracking**: Real-time updates during vault creation and signing
- **Balance Updates**: Notifications when balances change
- **Transaction Events**: Alerts when transactions are broadcast
- **Error Handling**: Graceful error reporting and recovery

## Project Structure

```
examples/cli/
├── package.json           # Dependencies and scripts
├── tsconfig.json          # TypeScript configuration
├── README.md              # This file
├── .env.example           # Environment variable template
├── .gitignore             # Git ignore rules
└── src/
    ├── index.ts           # Main CLI interface
    ├── wallet.ts          # Vault operations wrapper (VaultManager)
    ├── transaction.ts     # Transaction helpers (TransactionManager)
    └── types.ts           # Shared types and interfaces
```

## Testing

**⚠️ Use testnets for development:**

### Supported Testnets

- **Ethereum**: Sepolia ([Faucet](https://sepoliafaucet.com))
- **Bitcoin**: Testnet3 ([Faucet](https://testnet-faucet.com/btc-testnet))
- **Polygon**: Amoy ([Faucet](https://faucet.polygon.technology))

### Testing Checklist

1. ✅ Create a new vault
2. ✅ Get testnet tokens from faucet
3. ✅ Check balances
4. ✅ Send a test transaction
5. ✅ Export vault for backup
6. ✅ Import vault from backup
7. ✅ Check portfolio value

### Example Test Flow

```bash
# 1. Create vault
npm run wallet create

# 2. Get your Sepolia address
npm run wallet addresses

# 3. Get testnet ETH from https://sepoliafaucet.com

# 4. Wait a few minutes, then check balance
npm run wallet balance Ethereum

# 5. Send a test transaction
npm run wallet send Ethereum 0xRecipientAddress... 0.001

# 6. Verify on explorer
# The CLI will show you the explorer URL
```

## Security Best Practices

### Password Management

- Never log or display passwords
- Use strong passwords (min 8 characters, ideally 16+)
- Password input is masked in the CLI
- Store passwords in `.env` only for development/testing (see Configuration section)
- For production, omit `VAULT_PASSWORD` variables to get prompted interactively
- Each CLI command runs independently - no password caching between commands

### Vault Files

- Always encrypt exports with a password
- Store vault files in a secure location
- **Never commit .vult files to git** (already in .gitignore)
- Create regular encrypted backups

### Environment Variables

- Add `.env` to `.gitignore` (already included)
- Use `.env.example` for safe defaults
- Never commit API keys or passwords

### Transaction Safety

- Always preview transactions before signing
- Use testnet for development and testing
- Double-check addresses before sending
- Verify amounts and gas fees
- Keep small amounts on hot wallets

## Error Handling

The CLI provides helpful error messages:

```bash
# Invalid chain
✗ Invalid chain: InvalidChain

# Wrong password
✗ Vault error: Invalid password

# No active vault
✗ No active vault. Create or import a vault first.

# Network error
✗ Transaction failed: Network error. Check connection.
```

## Development

### Build

```bash
npm run build
```

### Run in Development Mode

```bash
npm run dev -- balance
```

### Type Checking

```bash
npm run typecheck
```

## Learn More

- [Vultisig SDK Documentation](../../packages/sdk/README.md)
- [Transaction Broadcasting](../../docs/examples/broadcast-transaction.md)
- [Event System Guide](../../docs/plans/UNIFIED_EVENT_SYSTEM.md)

## Troubleshooting

### "No active vault" error

Create a vault first:

```bash
npm run wallet create
```

### "Network error" during transaction

1. Check your internet connection
2. Verify the blockchain RPC is accessible
3. Try again in a few moments

### "Insufficient balance" error

1. Check your balance: `npm run wallet balance <chain>`
2. Ensure you have enough for gas fees
3. Get testnet tokens from a faucet

### Verification code not received

1. Check your spam folder
2. Wait a few minutes
3. Try creating the vault again

## Contributing

This example is part of the Vultisig SDK. Contributions are welcome!

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT

## Support

For issues and questions:

- [GitHub Issues](https://github.com/vultisig/vultisig-sdk/issues)
- [Documentation](https://docs.vultisig.com)
