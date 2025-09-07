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

This is a monorepo with workspace packages. **Always run `yarn install` from the root directory first.**

```bash
# Clone the repository
git clone https://github.com/vultisig/vultisig-sdk.git
cd vultisig-sdk

# IMPORTANT: Install dependencies from root (sets up all workspaces)
yarn install

# Build the SDK (bundles all workspace packages)
yarn workspace @vultisig/sdk build

# Run tests
yarn workspace @vultisig/sdk test

# Build and run the React example
yarn build:prod
```

### Project Structure

This is a **monorepo** where the SDK (`src/`) bundles functionality from workspace packages:

```
├── src/                 # SDK source code (bundles core/ and lib/)
│   ├── chains/         # Address derivation and chain management
│   ├── mpc/           # Multi-party computation logic
│   ├── vault/         # Vault creation and management
│   ├── server/        # Fast vault server integration
│   ├── tests/         # SDK test suite
│   └── wasm/          # WASM module management
├── core/              # Core blockchain functionality (bundled into SDK)
│   ├── chain/         # Chain-specific implementations
│   ├── mpc/           # MPC protocol implementations
│   └── ui/            # UI components and utilities
├── lib/               # Shared libraries and utilities (bundled into SDK)
│   ├── utils/         # Common utilities
│   ├── ui/            # UI library components
│   └── dkls/          # DKLS WASM bindings
├── examples/
│   └── react/         # React example application
└── clients/           # Client applications (extension, CLI)
```

### Build Process

The SDK uses **workspace bundling** - it includes all necessary code from `core/` and `lib/` packages into a single distributable bundle.

#### Build SDK
```bash
# From root directory (after yarn install)
yarn workspace @vultisig/sdk build
```
This creates the distributable SDK package in `src/dist/` with all workspace dependencies bundled.

#### Run Tests
```bash
# From root directory
yarn workspace @vultisig/sdk test
```


### Available Scripts

- `yarn workspace @vultisig/sdk build` - Build the SDK with all workspace dependencies
- `yarn workspace @vultisig/sdk test` - Run SDK tests
- `yarn build:prod` - Build and serve the React example app
- `yarn lint` - Run ESLint across all packages
- `yarn typecheck` - Run TypeScript type checking

## API Documentation

TODO

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