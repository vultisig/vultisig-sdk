# VultisigSDK

A TypeScript SDK for multi-party computation (MPC) wallet operations, providing secure vault creation, address derivation, and transaction signing capabilities.

## Overview

VultisigSDK enables developers to integrate MPC wallet functionality into their applications. The SDK uses server-assisted Fast Vault creation with comprehensive blockchain support including Bitcoin, Ethereum, Cosmos, and many others.

## Features

- **Multi-Party Computation**: Secure 2-of-2 threshold key generation and signing with VultiServer
- **Address Derivation**: Generate blockchain addresses using WalletCore WASM
- **Vault Management**: Create, import, export, and manage encrypted vaults
- **Server-Assisted Signing**: Fast, secure transaction signing via VultiServer
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
import { Vultisig } from "vultisig-sdk";

// Initialize SDK
const sdk = new Vultisig();
await sdk.initialize();

// Create a fast vault (server-assisted)
const vault = await sdk.createVault("My Wallet", {
  type: "fast",
  email: "user@example.com",
  password: "secure-password",
});

// Derive addresses for different chains
const btcAddress = await vault.address("Bitcoin");
const ethAddress = await vault.address("Ethereum");

console.log("Bitcoin Address:", btcAddress);
console.log("Ethereum Address:", ethAddress);
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
```

### Project Structure

This is a **monorepo** with the following structure:

```
vultisig-sdk/
├── packages/
│   ├── sdk/               # SDK workspace package (@vultisig/sdk)
│   │   ├── src/          # SDK source code
│   │   │   ├── chains/   # Address derivation and chain management
│   │   │   ├── mpc/      # Multi-party computation logic
│   │   │   ├── vault/    # Vault creation and management
│   │   │   ├── server/   # Fast vault server integration
│   │   │   └── wasm/     # WASM module management
│   │   └── tests/        # SDK test suite
│   ├── core/             # ⚠️ UPSTREAM CODE - DO NOT EDIT
│   │   ├── chain/        # Chain-specific implementations
│   │   ├── mpc/          # MPC protocol implementations
│   │   └── ui/           # UI components and utilities
│   └── lib/              # ⚠️ UPSTREAM CODE - DO NOT EDIT
│       ├── utils/        # Common utilities
│       ├── ui/           # UI library components
│       └── dkls/         # DKLS WASM bindings
├── clients/cli/          # CLI workspace
├── examples/             # Example workspaces
└── package.json          # Root workspace
```

**⚠️ IMPORTANT: Do Not Edit Upstream Code**

The `packages/core/` and `packages/lib/` directories contain code synced from the [vultisig-windows](https://github.com/vultisig/vultisig-windows) repository. **These directories should NEVER be modified directly.**

- ❌ **Do NOT** edit files in `packages/core/` or `packages/lib/`
- ✅ **Do** make changes in the upstream vultisig-windows repository
- ✅ **Do** sync changes using `yarn sync-and-copy` after upstream updates

All imports use TypeScript path aliases:

- `@core/*` → `packages/core/*`
- `@lib/*` → `packages/lib/*`

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

### Syncing from vultisig-windows

The SDK syncs core functionality from the [vultisig-windows](https://github.com/vultisig/vultisig-windows) repository. To update to the latest upstream code:

```bash
# Fetch latest code from vultisig-windows and copy to src/
yarn sync-and-copy
```

This fetches the latest `core/`, `lib/`, and `clients/` directories from vultisig-windows, transforms imports from package paths to relative paths, and copies selected files to `src/`. See [SUBTREE-SYNC.md](docs/SUBTREE-SYNC.md) for details.

### Available Scripts

- `yarn workspace @vultisig/sdk build` - Build the SDK with all workspace dependencies
- `yarn workspace @vultisig/sdk test` - Run SDK tests
- `yarn sync-and-copy` - Sync latest code from vultisig-windows
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
