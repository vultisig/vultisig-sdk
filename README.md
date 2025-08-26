# VultisigSDK

A TypeScript SDK for multi-party computation (MPC) wallet operations, providing secure vault creation, address derivation, and transaction signing capabilities.

## Overview

VultisigSDK enables developers to integrate MPC wallet functionality into their applications. The SDK supports both "Fast Vault" (server-assisted) and "Secure Vault" (fully decentralized) creation modes, with comprehensive blockchain support including Bitcoin, Ethereum, Cosmos, and many others.

## Features

- **Multi-Party Computation**: Secure key generation and signing using DKLS and Schnorr protocols
- **Address Derivation**: Generate blockchain addresses using WalletCore WASM
- **Vault Management**: Create, import, export, and manage encrypted vaults
- **Fast Vault Creation**: Server-assisted vault creation with email verification
- **Cross-Chain Support**: Bitcoin, Ethereum, Cosmos, Solana, and 40+ blockchains
- **TypeScript**: Full type safety and IntelliSense support

## Installation

```bash
npm install vultisig-sdk
# or
yarn add vultisig-sdk
```

## Quick Start

```typescript
import { VultisigSDK } from 'vultisig-sdk'

// Initialize SDK
const sdk = new VultisigSDK()
await sdk.initialize()

// Create a Fast Vault (server-assisted)
const result = await sdk.createFastVault({
  name: 'My Wallet',
  email: 'user@example.com',
  password: 'secure-password'
})

// Derive addresses for different chains
const btcAddress = await sdk.deriveAddress(result.vault, 'Bitcoin')
const ethAddress = await sdk.deriveAddress(result.vault, 'Ethereum')

console.log('Bitcoin Address:', btcAddress)
console.log('Ethereum Address:', ethAddress)
```

## Development

### Prerequisites

- Node.js 18+
- Yarn 4.x

### Setup

```bash
# Clone the repository
git clone https://github.com/vultisig/vultisig-sdk.git
cd vultisig-sdk

# Install dependencies
yarn install

# Build the SDK
cd src && npm run build

# Build and run the React example
yarn build:prod
```

### Project Structure

```
├── src/                 # SDK source code
│   ├── chains/         # Address derivation and chain management
│   ├── mpc/           # Multi-party computation logic
│   ├── vault/         # Vault creation and management
│   ├── server/        # Fast vault server integration
│   └── wasm/          # WASM module management
├── examples/
│   └── react/         # React example application
├── core/              # Core blockchain functionality
├── lib/               # Shared libraries and utilities
└── clients/           # Client applications
```

### Building

#### Build SDK Only
```bash
cd src
npm run build
```
This creates the distributable SDK package in `src/dist/`.

#### Build & Run Example App
```bash
yarn build:prod
```
This command:
1. Builds the React example app in production mode
2. Starts a preview server at http://localhost:5175/
3. Includes the full SDK with all dependencies (~4.4MB bundle)

#### Development Mode
```bash
# Start React example in development mode
cd examples/react
yarn dev
```

### Available Scripts

- `yarn build:prod` - Build and serve the React example app
- `yarn lint` - Run ESLint across all packages
- `yarn typecheck` - Run TypeScript type checking
- `yarn test` - Run tests with Vitest

## API Documentation

### VultisigSDK Class

#### Constructor
```typescript
const sdk = new VultisigSDK(options?: {
  serverUrl?: string
  mpcServerUrl?: string
})
```

#### Core Methods

##### `initialize(): Promise<void>`
Initialize the SDK and WASM modules.

##### `createFastVault(params): Promise<CreateVaultResult>`
Create a server-assisted vault with email verification.
```typescript
const result = await sdk.createFastVault({
  name: 'My Wallet',
  email: 'user@example.com', 
  password: 'secure-password'
})
```

##### `deriveAddress(vault, chain): Promise<string>`
Derive blockchain address for a specific chain.
```typescript
const address = await sdk.deriveAddress(vault, 'Bitcoin')
```

##### `importVaultFromFile(file, password?): Promise<Vault>`
Import vault from encrypted backup file.

##### `exportVault(vault, password?): Promise<string>`
Export vault to encrypted JSON string.

### Supported Chains

- **Bitcoin**: BTC, BCH, LTC, DOGE, DASH
- **Ethereum**: ETH, BSC, Polygon, Arbitrum, Optimism, Base
- **Cosmos**: ATOM, OSMO, KUJI, THOR, MAYA
- **Others**: Solana, Polkadot, Ripple, TON, TRON
- **40+ chains total**

## Examples

### Creating a Secure Vault (Decentralized)
```typescript
// Secure vaults require multiple devices for MPC
const vault = await sdk.createSecureVault({
  name: 'Hardware Vault',
  threshold: 2, // 2-of-3 multisig
  participants: 3
})
```

### Address Derivation
```typescript
// Derive addresses for multiple chains
const addresses = await Promise.all([
  sdk.deriveAddress(vault, 'Bitcoin'),
  sdk.deriveAddress(vault, 'Ethereum'), 
  sdk.deriveAddress(vault, 'Cosmos')
])
```

### Vault Import/Export
```typescript
// Export vault with encryption
const backupData = await sdk.exportVault(vault, 'backup-password')

// Import from backup
const importedVault = await sdk.importVaultFromFile(backupFile, 'backup-password')
```

## Security

- **No Private Keys**: Private keys never exist in complete form
- **MPC Security**: Keys are split across multiple parties using threshold signatures
- **Encryption**: All vault data is encrypted with user passwords
- **WASM Isolation**: Cryptographic operations run in WebAssembly sandbox

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/new-feature`)
3. Make your changes
4. Add tests if applicable
5. Run `yarn lint && yarn typecheck && yarn test`
6. Commit your changes (`git commit -am 'Add new feature'`)
7. Push to the branch (`git push origin feat/new-feature`)
8. Create a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](src/LICENSE) file for details.

## Support

- **Documentation**: [docs.vultisig.com](https://docs.vultisig.com)
- **Issues**: [GitHub Issues](https://github.com/vultisig/vultisig-sdk/issues)
- **Community**: [Discord](https://discord.gg/vultisig)

---

Built with ❤️ by the Vultisig Team