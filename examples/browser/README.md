# Vultisig Browser Example

Browser-based example application demonstrating the Vultisig SDK for fast vault management.

## Features

- 🔐 Create fast vaults with email verification
- 📦 Import/export vault files
- 💰 Check balances across multiple chains
- 💸 Send transactions with 2-of-2 signing
- 📊 Real-time event logging
- 🎨 Modern React UI with Tailwind CSS
- 📑 Multi-vault tab interface

## Getting Started

### Prerequisites

- Node.js 18+
- Yarn

### Installation

```bash
cd examples/browser
yarn install
```

### Development

```bash
yarn dev
```

Open http://localhost:3000

### Build

```bash
yarn build
yarn preview
```

## Usage

### Create a Vault

1. Click "Create New Vault"
2. Enter vault name, email, and password
3. Check email for verification code
4. Enter code to complete creation

### Import Vaults

1. Click "Import Vault(s)"
2. Select one or more .vult files
3. Vaults will open in separate tabs

### Check Balances

1. Select a vault from the tabs
2. Click "Check Balances" to fetch balances for all chains

### Send Transaction

1. Select chain and enter recipient address
2. Enter amount to send
3. Click "Send Transaction"
4. Transaction will be signed and broadcast automatically

## Architecture

- **React 18**: UI framework
- **Vite**: Build tool and dev server
- **TypeScript**: Type safety
- **Tailwind CSS**: Utility-first CSS framework
- **Vultisig SDK**: Wallet functionality
- **IndexedDB**: Vault storage (via SDK)
- **LocalStorage**: App settings

## Project Structure

See [BROWSER_EXAMPLE_IMPLEMENTATION.md](../../docs/plans/BROWSER_EXAMPLE_IMPLEMENTATION.md) for detailed architecture and implementation guide.

## Key Features

### Multi-Vault Tab Interface

- Open multiple vaults simultaneously
- Switch between vaults instantly
- Independent operations per vault
- Unified event log showing activity from all vaults

### Real-Time Event Logging

- All SDK and vault events are logged in real-time
- Events are color-coded by type
- Auto-scroll option for monitoring
- Events show vault context with name prefixes

### Browser-Optimized

- Uses Web Crypto API and IndexedDB
- Polyfills for Node.js modules
- WASM support for cryptographic operations
- Responsive design with Tailwind CSS

## Development

### Type Checking

```bash
yarn typecheck
```

### Building for Production

```bash
yarn build
```

The build output will be in the `dist/` directory.

## Troubleshooting

### WASM Loading Fails

- Ensure `vite-plugin-wasm` is installed
- Check that WASM files are accessible

### Buffer is not defined

- Verify `vite-plugin-node-polyfills` is configured
- Check the polyfill settings in `vite.config.ts`

### IndexedDB Quota Exceeded

- Clear browser data
- Implement vault cleanup/archiving

### Transaction Signing Timeout

- Check VultiServer connectivity
- Verify vault is unlocked
- Ensure network connection is stable

## License

MIT
