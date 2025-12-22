# VultisigSDK

A TypeScript SDK for multi-party computation (MPC) wallet operations, providing secure vault creation, address derivation, and transaction signing capabilities.

## Overview

VultisigSDK enables developers to integrate MPC wallet functionality into their applications. The SDK supports two vault types:

- **Fast Vault**: Server-assisted 2-of-2 MPC for quick setup and instant signing
- **Secure Vault**: Multi-device N-of-M MPC for enhanced security with configurable thresholds

Both vault types provide comprehensive blockchain support including Bitcoin, Ethereum, Cosmos, Solana, and 40+ others.

## Features

- **Fast Vault**: Server-assisted 2-of-2 MPC with VultiServer for instant signing
- **Secure Vault**: Multi-device N-of-M threshold signing with mobile device pairing
- **QR Code Pairing**: Pair with Vultisig mobile apps for secure vault operations
- **Address Derivation**: Generate blockchain addresses using WalletCore WASM
- **Vault Management**: Create, import, export, and manage encrypted vaults
- **Cross-Chain Support**: Bitcoin, Ethereum, Cosmos, Solana, and 40+ blockchains
- **TypeScript**: Full type safety and IntelliSense support

## Installation

```bash
npm install @vultisig/sdk
# or
yarn add @vultisig/sdk
```

## Quick Start

### Fast Vault (Server-Assisted)

```typescript
import { Vultisig, MemoryStorage } from '@vultisig/sdk'

// Initialize SDK
const sdk = new Vultisig({ storage: new MemoryStorage() })
await sdk.initialize()

// Create a fast vault (server-assisted 2-of-2)
const vaultId = await sdk.createFastVault({
  name: "My Wallet",
  email: "user@example.com",
  password: "secure-password",
});

// Verify with email code
const vault = await sdk.verifyVault(vaultId, "1234");

// Derive addresses
const btcAddress = await vault.address("Bitcoin");
const ethAddress = await vault.address("Ethereum");
```

### Secure Vault (Multi-Device)

```typescript
// Create a secure vault (2-of-3 threshold)
const { vault } = await sdk.createSecureVault({
  name: "Team Wallet",
  devices: 3,
  onQRCodeReady: (qrPayload) => {
    // Display QR code for other devices to scan
    displayQRCode(qrPayload);
  },
  onDeviceJoined: (deviceId, total, required) => {
    console.log(`Device joined: ${total}/${required}`);
  }
});

// Sign transactions (requires device coordination)
await vault.sign(payload, {
  onQRCodeReady: (qr) => displayQRCode(qr),
  onDeviceJoined: (id, total, required) => {
    console.log(`Signing: ${total}/${required} devices ready`);
  }
});
```

## API Documentation

API documentation is auto-generated and available at:
- https://vultisig.github.io/vultisig-sdk/

For detailed usage, see the [SDK Users Guide](docs/SDK-USERS-GUIDE.md).

## Security

- **No Private Keys**: Private keys never exist in complete form
- **MPC Security**: Keys are split across multiple parties using threshold signatures
- **Configurable Thresholds**: Secure vaults support N-of-M signing (e.g., 2-of-3, 3-of-5)
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
