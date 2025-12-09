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
npm install @vultisig/sdk
# or
yarn add @vultisig/sdk
```

## Quick Start

```typescript
import { Vultisig, MemoryStorage } from '@vultisig/sdk'

// Initialize SDK with storage
const sdk = new Vultisig({
  storage: new MemoryStorage()
})
await sdk.initialize()

// Create a fast vault (server-assisted)
const { vault, verificationRequired, vaultId } = await sdk.createFastVault({
  name: "My Wallet",
  email: "user@example.com",
  password: "secure-password",
});

// Handle email verification if required
if (verificationRequired) {
  const code = "1234"; // Get from user input
  await sdk.verifyVault(vaultId, code);
}

// Derive addresses for different chains
const btcAddress = await vault.address("Bitcoin");
const ethAddress = await vault.address("Ethereum");

console.log("Bitcoin Address:", btcAddress);
console.log("Ethereum Address:", ethAddress);
```

## API Documentation

API documentation is auto-generated and available at:
- https://vultisig.github.io/vultisig-sdk/

For detailed usage, see the [SDK Users Guide](docs/SDK-USERS-GUIDE.md).

## Security

- **No Private Keys**: Private keys never exist in complete form
- **MPC Security**: Keys are split across multiple parties using threshold signatures
- **Encryption**: All vault data is encrypted with user passwords
- **WASM Isolation**: Cryptographic operations run in WebAssembly sandbox

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, project structure, and contribution guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- **Documentation**: [docs.vultisig.com](https://docs.vultisig.com)
- **Issues**: [GitHub Issues](https://github.com/vultisig/vultisig-sdk/issues)
- **Community**: [Discord](https://discord.gg/vultisig)

---

Built with ❤️ by the Vultisig Team
