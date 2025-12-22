# Vultisig Browser Example

Browser-based example application demonstrating the Vultisig SDK for fast vault management.

## Features

- 🔐 Create fast vaults with email verification
- 🛡️ Create secure vaults with multi-device MPC (QR pairing)
- 📦 Import/export vault files
- 💰 Check balances across multiple chains
- 💸 Send transactions (fast vault: instant, secure vault: device coordination)
- 📲 QR code display for mobile device pairing
- 📊 Real-time event logging and device join tracking
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

### Create a Fast Vault

1. Click "Create New Vault"
2. Select "Fast Vault" type
3. Enter vault name, email, and password
4. Check email for verification code
5. Enter code to complete creation

### Create a Secure Vault

1. Click "Create New Vault"
2. Select "Secure Vault" type
3. Enter vault name and number of devices (e.g., 3 for 2-of-3)
4. Optionally set a password for vault encryption
5. A QR code displays on screen
6. Other participants scan with Vultisig mobile app (iOS/Android)
7. Device join progress shows in real-time
8. Keygen runs automatically when all devices join
9. Vault is created and ready to use

### Import Vaults

1. Click "Import Vault(s)"
2. Select one or more .vult files
3. Vaults will open in separate tabs

### Check Balances

1. Select a vault from the tabs
2. Click "Check Balances" to fetch balances for all chains

### Send Transaction

**Fast Vault:**
1. Select chain and enter recipient address
2. Enter amount to send
3. Click "Send Transaction"
4. Transaction is signed instantly and broadcast

**Secure Vault:**
1. Select chain and enter recipient address
2. Enter amount to send
3. Click "Send Transaction"
4. A QR code displays for signing session
5. Other participants scan with Vultisig app to approve
6. Device join progress shows (e.g., "2/3 devices ready")
7. Once threshold reached, signature is generated
8. Transaction is broadcast

## Architecture

- **React 18**: UI framework
- **Vite**: Build tool and dev server
- **TypeScript**: Type safety
- **Tailwind CSS**: Utility-first CSS framework
- **Vultisig SDK**: Wallet functionality
- **IndexedDB**: Vault storage (via SDK)
- **LocalStorage**: App settings
- **7z-wasm**: LZMA compression for QR payloads (secure vault)

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

### Secure Vault UI Components

The example includes specialized components for secure vault operations:

- **SecureVaultCreator** - Multi-step form for vault creation with device pairing
- **SigningModal** - Transaction signing flow with QR and device tracking
- **QRCodeModal** - Displays QR codes for mobile app scanning
- **DeviceProgress** - Shows device join progress (e.g., "2/3 devices ready")
- **ProgressModal** - Generic progress display for keygen/signing phases

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
