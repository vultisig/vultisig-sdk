# Vultisig CLI Wallet - Node.js Example

A complete command-line wallet application demonstrating the Vultisig SDK for Node.js developers.

## What's New 🆕

This example has been updated to showcase the latest Vultisig SDK features:

- **🔓 Password Cache System**: Unlock your vault once and sign multiple transactions without re-entering your password
- **⚙️ Global Configuration**: Simplified SDK initialization with global singletons for storage, server endpoints, and config
- **🎯 Smart Password Prompts**: Automatic password prompting with configurable TTL (time-to-live)
- **🏗️ Polymorphic Vaults**: Type-safe vault operations with FastVault and SecureVault classes
- **🔐 Lock/Unlock Commands**: Manually control password cache for enhanced security

### Migration from Previous Versions

The SDK has simplified its API:
- Storage is now configured with `StorageOptions` instead of instantiating `NodeStorage`
- Password management is handled globally via `GlobalConfig.onPasswordRequired` callback
- Sign operations no longer require password parameter (resolved automatically from cache or callback)
- Vault verification uses `sdk.verifyVault()` instead of `sdk.serverManager.verifyVault()`

## Features

- 🔐 Secure vault creation and management
- 🌍 Multi-chain support (40+ blockchains)
- 💰 Balance checking and portfolio tracking
- 💸 Transaction signing and broadcasting
- 📊 Fiat value tracking
- 🎯 Event-driven architecture
- 🛡️ Production-ready error handling
- 🔓 Password caching with configurable TTL

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

| Command | Description |
|---------|-------------|
| `create` | Create a new vault |
| `import <file>` | Import vault from .vult file |
| `balance [chain]` | Show balances for all chains or a specific chain |
| `send <chain> <to> <amount>` | Send transaction |
| `portfolio` | Show total portfolio value |
| `export [path]` | Export vault to file |
| `addresses` | Show all vault addresses |
| `chains` | List chains (use --add or --remove to manage) |
| `lock` | Lock the vault (clear password cache) |
| `unlock` | Unlock the vault (cache password for configured TTL) |
| `status` | Check vault lock status and password cache TTL |

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
PASSWORD_CACHE_TTL=300000  # 5 minutes (in milliseconds)
USE_TESTNET=true  # Recommended for development
```

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

### Password Cache Management

The SDK includes a smart password cache system that keeps your vault unlocked for a configurable duration (default: 5 minutes).

```bash
# Check if vault is locked or unlocked
npm run wallet status

# Unlock vault (will prompt for password)
npm run wallet unlock

# Now you can sign transactions without re-entering password
npm run wallet send Ethereum 0xRecipient... 0.01

# Lock vault manually for security
npm run wallet lock

# Next operation will prompt for password again
npm run wallet balance
```

**How it works:**
- First operation requires your password
- Password is cached securely for the configured TTL
- Subsequent operations use the cached password automatically
- Cache expires after TTL or when you run `lock`
- You can customize TTL via `PASSWORD_CACHE_TTL` in `.env`

**Example workflow:**
```bash
# 1. Check vault status
npm run wallet status
# Output: Status: Locked 🔒

# 2. Unlock vault
npm run wallet unlock
# Enter password once

# 3. Send multiple transactions without re-entering password
npm run wallet send Ethereum 0xAddr1... 0.01
npm run wallet send Ethereum 0xAddr2... 0.02
npm run wallet send Ethereum 0xAddr3... 0.03

# 4. Check remaining time
npm run wallet status
# Output: TTL: 3m 45s remaining

# 5. Lock when done for security
npm run wallet lock
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
examples/nodejs/
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
- Passwords are cached securely in memory with configurable TTL
- Use `npm run wallet lock` to clear password cache when finished
- Consider shorter TTL values for production environments
- Password cache automatically expires after configured duration

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
