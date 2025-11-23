# Vultisig Interactive Shell

An interactive shell for wallet management built using Node.js's built-in `repl` module, providing a superior interactive experience compared to readline-based implementations.

## Features

### ✨ Improved Over Readline Implementation
- **Empty input handling** - Pressing Enter works perfectly without workarounds
- **No complex hacks** - Built-in prompt management and command handling
- **Better async support** - Designed for asynchronous operations
- **Command history** - Built-in history with up/down arrow navigation
- **Tab completion** - Autocomplete for commands
- **Error recovery** - Doesn't crash on errors, maintains session state

### 🔐 Vault Management
- Create new vaults with password encryption
- Import existing vault files
- Switch between multiple vaults
- Email verification for new vaults
- Password caching with configurable TTL

### 💰 Wallet Operations
- Check balances across all chains
- View portfolio value in multiple currencies
- Display all wallet addresses
- Add/remove blockchain networks
- Lock/unlock vaults

### 📤 Transaction Support
- Send native tokens and ERC-20/BEP-20 tokens
- Transaction signing and broadcasting
- Gas estimation and optimization
- Multi-chain support

## Installation

```bash
# Install dependencies
yarn install

# Build the TypeScript code
yarn build
```

## Usage

### Start the Shell

```bash
# Using yarn
yarn shell

# Or directly with tsx
yarn dev
```

### Available Commands

Once in the shell, you can use these commands:

#### Getting Help
- `help` or `?` - Show all available commands
- `.help` - Alternative way to show help (Shell dot-command)

#### Vault Management
- `vaults` - List all vaults
- `vault <number>` - Switch to vault by number
- `import <file>` - Import vault from .vult file
- `create` - Create a new vault

#### Wallet Operations
- `balance [chain]` - Show balance for a specific chain or all chains
- `portfolio` - Display total portfolio value
- `addresses` - Show all wallet addresses
- `chains` - List supported chains
- `status` - Show vault lock status

#### Transactions
- `send <chain> <to> <amount>` - Send transaction
  - Example: `send ethereum 0x123... 0.1`
  - With token: `send ethereum 0x123... 100 --token USDT`
  - With memo: `send cosmos cosmos1... 10 --memo "Payment"`

#### Vault Security
- `lock` - Lock the vault (clear password cache)
- `unlock` - Unlock vault (cache password for TTL)
- `export [path]` - Export vault to file

#### Shell Commands (dot-commands)
- `.help` - Show help information
- `.clear` - Clear the screen
- `.exit` - Exit the shell

### Empty Input Handling

Unlike readline-based implementations, this shell handles empty input naturally:
```
wallet> [Press Enter]
wallet> [Press Enter]
wallet> [Press Enter]
```
Each Enter press shows a new prompt on a new line without any issues.

### Tab Completion

Start typing a command and press Tab to autocomplete:
```
wallet> bal[Tab]
wallet> balance
```

### Command History

Use up/down arrows to navigate through command history:
```
wallet> balance ethereum
wallet> [Up Arrow]
wallet> balance ethereum
```

## Configuration

### Environment Variables

Create a `.env` file in the shell directory:

```bash
# Vault Configuration
VAULT_FILE_PATH=./path/to/vault.vult  # Auto-import on startup
VAULT_PASSWORD=your_password          # Password for auto-import
VAULT_STORAGE_PATH=./vaults          # Storage directory for vaults

# Password Cache
PASSWORD_CACHE_TTL=300000             # Cache duration in ms (5 minutes)

# Default Settings
DEFAULT_CURRENCY=usd                  # Default fiat currency
```

## Examples

### Creating a New Vault

```
wallet> create
Enter vault name: MyVault
Enter password: ********
Confirm password: ********
Enter email for verification: user@example.com
✓ Vault created: MyVault
```

### Checking Balances

```
wallet[MyVault]🔓> balance
┌─────────────┬─────────────────────┬────────┐
│ Chain       │ Balance             │ Symbol │
├─────────────┼─────────────────────┼────────┤
│ Ethereum    │ 1.234               │ ETH    │
│ Bitcoin     │ 0.0125              │ BTC    │
│ Binance     │ 250.50              │ BNB    │
└─────────────┴─────────────────────┴────────┘
```

### Sending a Transaction

```
wallet[MyVault]🔓> send ethereum 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0 0.1
⠋ Preparing transaction...
✓ Transaction prepared

Transaction Details:
  From: 0x123...abc
  To: 0x742...Eb0
  Amount: 0.1 ETH
  Gas: 21000
  Total: 0.10063 ETH

Confirm transaction? (y/N) y
⠋ Signing transaction...
✓ Transaction signed
⠋ Broadcasting transaction...
✓ Transaction broadcast

Transaction Hash: 0xabc...123
Explorer: https://etherscan.io/tx/0xabc...123
```

## Architecture

### Key Components

1. **shell-session.ts** - Main shell session manager using Node's `repl` module
2. **index.ts** - Entry point and initialization
3. **utils/wallet.ts** - Vault management functionality
4. **utils/transaction.ts** - Transaction preparation and signing
5. **commands/** - Command display and handling logic

### Advantages Over Readline

The Node.js REPL module provides:
- Built-in command parsing and evaluation
- Automatic prompt management
- Command history persistence
- Error recovery without crashing
- Native async/await support
- Customizable evaluation functions
- Built-in `.commands` support

## Development

### Running in Development Mode

```bash
# Watch mode with automatic restart
yarn dev
```

### Building

```bash
# Compile TypeScript
yarn build

# Run compiled version
yarn start
```

### Type Checking

```bash
yarn typecheck
```

## Troubleshooting

### Empty Input Not Working
This implementation solves the empty input issue completely. If you still experience issues, ensure you're using the shell version, not the readline version.

### Command Not Recognized
The shell silently ignores unknown commands. Check spelling and use `.help` to see available commands.

### Vault Not Loading
1. Check the vault file path is correct
2. Verify the password if the vault is encrypted
3. Ensure the vault file is a valid .vult format

### Transaction Failing
1. Ensure the vault is unlocked
2. Check sufficient balance including gas fees
3. Verify the recipient address format
4. Check network connectivity

## License

See the main repository LICENSE file for details.