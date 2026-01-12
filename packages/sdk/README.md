# Vultisig SDK

> **⚠️ Beta Release**: This SDK is currently in beta. APIs may change before the stable 1.0 release.

A TypeScript SDK for secure multi-party computation (MPC) and blockchain operations using the Vultisig protocol. Build secure, decentralized applications with threshold signature schemes and multi-chain support.

## Features

- 🔐 **Multi-Party Computation (MPC)** - Secure threshold signatures using DKLS and Schnorr protocols
- 🏦 **Fast Vault** - Server-assisted 2-of-2 vault for quick setup and instant signing
- 🛡️ **Secure Vault** - Multi-device N-of-M threshold signing with mobile device pairing
- 📲 **QR Code Pairing** - Pair with Vultisig mobile apps (iOS/Android) for vault creation and signing
- 🌐 **Multi-Chain Support** - Bitcoin, Ethereum, Solana, THORChain, and 40+ blockchains
- 🔗 **Address Derivation** - Generate addresses across multiple blockchain networks
- 📱 **Cross-Platform** - Works in browsers, Node.js, and Electron (React Native coming soon)
- 🔒 **Vault Management** - Import, export, encrypt, and decrypt vault keyshares
- 🔑 **Seedphrase Import** - Import existing BIP39 mnemonics with automatic chain discovery
- 🌍 **WASM Integration** - High-performance cryptographic operations via WebAssembly

## Installation

```bash
npm install @vultisig/sdk
```

## Quick Start

### 1. Initialize the SDK

```typescript
import { Vultisig, MemoryStorage } from '@vultisig/sdk'

const sdk = new Vultisig({
  storage: new MemoryStorage()
})

// Initialize WASM modules
await sdk.initialize()
```

### 2. Create a Fast Vault (Server-Assisted)

```typescript
// Create a new vault using VultiServer
const vaultId = await sdk.createFastVault({
  name: "My Secure Wallet",
  email: "user@example.com",
  password: "SecurePassword123!",
});

// User will receive a verification code via email
const code = "1234"; // Get from user input
const vault = await sdk.verifyVault(vaultId, code);
```

### 3. Derive Blockchain Addresses

```typescript
// Derive addresses for different blockchain networks
const btcAddress = await vault.address("Bitcoin");
const ethAddress = await vault.address("Ethereum");
const solAddress = await vault.address("Solana");

console.log("BTC:", btcAddress); // bc1q...
console.log("ETH:", ethAddress); // 0x...
console.log("SOL:", solAddress); // 9WzD...
```

### 4. Create a Secure Vault (Multi-Device)

```typescript
// Create a secure vault with 2-of-3 threshold
const { vault, vaultId, sessionId } = await sdk.createSecureVault({
  name: "Team Wallet",
  devices: 3,                    // Total number of devices
  threshold: 2,                  // Optional: defaults to ceil((devices+1)/2)
  password: "optional-password", // Optional: encrypt the vault
  onQRCodeReady: (qrPayload) => {
    // Display this QR code for other devices to scan with Vultisig app
    displayQRCode(qrPayload);
  },
  onDeviceJoined: (deviceId, totalJoined, required) => {
    console.log(`Device joined: ${totalJoined}/${required}`);
  },
  onProgress: (step) => {
    console.log(`${step.step}: ${step.message}`);
  }
});

console.log("Vault created:", vault.name);
```

### 5. Sign with Secure Vault

```typescript
// Signing requires coordination with other devices
await vault.sign(transactionPayload, {
  onQRCodeReady: (qrPayload) => {
    // Display QR for devices to join the signing session
    displayQRCode(qrPayload);
  },
  onDeviceJoined: (deviceId, total, required) => {
    console.log(`Signing: ${total}/${required} devices ready`);
  },
  onProgress: (step) => {
    console.log(`Signing progress: ${step.message}`);
  }
});
```

### 6. Import/Export Vaults

```typescript
// Check if a vault file is encrypted
const isEncrypted = await sdk.isVaultFileEncrypted(file);

// Import vault from file
const vault = await sdk.addVault(file, isEncrypted ? "password" : undefined);

// Export vault to backup format (as Blob)
const backupBlob = await vault.export("BackupPassword123!");

// Or export as base64 string
const backupBase64 = await vault.exportAsBase64("BackupPassword123!");
```

### 7. Import from Seedphrase

Import an existing wallet from a BIP39 mnemonic:

```typescript
// Validate the seedphrase first
const validation = await sdk.validateSeedphrase(mnemonic)
if (!validation.valid) {
  console.error(validation.error)
  return
}

// Discover which chains have balances
const chains = await sdk.discoverChainsFromSeedphrase(
  mnemonic,
  [Chain.Bitcoin, Chain.Ethereum, Chain.THORChain],
  (progress) => console.log(`${progress.chain}: ${progress.phase}`)
)

for (const result of chains) {
  if (result.hasBalance) {
    console.log(`${result.chain}: ${result.balance} ${result.symbol}`)
  }
}

// Import as FastVault (requires email verification)
const vaultId = await sdk.importSeedphraseAsFastVault({
  mnemonic,
  name: 'Imported Wallet',
  email: 'user@example.com',
  password: 'SecurePassword123!',
  discoverChains: true, // Auto-enable chains with balances
  onProgress: (step) => console.log(step.message)
})

// Verify with email code
const vault = await sdk.verifyVault(vaultId, verificationCode)
```

## Supported Blockchains

The SDK supports address derivation and operations for 40+ blockchain networks:

| Network   | Chain ID    | Description         |
| --------- | ----------- | ------------------- |
| Bitcoin   | `bitcoin`   | Bitcoin mainnet     |
| Ethereum  | `ethereum`  | Ethereum mainnet    |
| Solana    | `solana`    | Solana mainnet      |
| THORChain | `thorchain` | THORChain mainnet   |
| Polygon   | `polygon`   | Polygon (MATIC)     |
| Avalanche | `avalanche` | Avalanche C-Chain   |
| BSC       | `bsc`       | Binance Smart Chain |
| Arbitrum  | `arbitrum`  | Arbitrum One        |
| Optimism  | `optimism`  | Optimism mainnet    |
| Cosmos    | `cosmos`    | Cosmos Hub          |
| Litecoin  | `litecoin`  | Litecoin mainnet    |
| Dogecoin  | `dogecoin`  | Dogecoin mainnet    |
| ...       | ...         | And many more       |

## Vault Types

The SDK supports two vault types for different security and usability requirements:

| Feature | Fast Vault | Secure Vault |
|---------|------------|--------------|
| **Threshold** | 2-of-2 | N-of-M (configurable) |
| **Setup** | Server-assisted, instant | Multi-device, requires pairing |
| **Signing** | Instant via VultiServer | Requires device coordination |
| **Use Cases** | Personal wallets, quick setup | Team wallets, high security, custody |
| **Device Pairing** | None required | QR code with Vultisig mobile app |
| **Password** | Required | Optional |

### When to Use Each Type

**Fast Vault** - Best for:
- Individual users wanting quick setup
- Development and testing
- Situations where server-assisted signing is acceptable

**Secure Vault** - Best for:
- Team or organizational wallets
- High-value assets requiring multi-party approval
- Scenarios requiring configurable thresholds (2-of-3, 3-of-5, etc.)
- Maximum security without server dependency during signing

## Framework Integration Example

The SDK works with any JavaScript framework. Here's a React example:

### React Component Example

```typescript
import { Vultisig, MemoryStorage } from '@vultisig/sdk'
import type { VaultBase } from '@vultisig/sdk'
import { useState, useEffect } from 'react'

function VaultApp() {
  const [sdk] = useState(() => new Vultisig({ storage: new MemoryStorage() }))
  const [vault, setVault] = useState<VaultBase | null>(null)
  const [addresses, setAddresses] = useState<Record<string, string>>({})

  useEffect(() => {
    // Initialize SDK on component mount
    sdk.initialize().catch(console.error)
  }, [sdk])

  const createVault = async () => {
    try {
      const vaultId = await sdk.createFastVault({
        name: 'My Wallet',
        email: 'user@example.com',
        password: 'SecurePassword123!'
      })

      // User receives verification code via email
      const code = prompt('Enter verification code from email:')
      const vault = await sdk.verifyVault(vaultId, code!)
      setVault(vault)
    } catch (error) {
      console.error('Vault creation failed:', error)
    }
  }

  const deriveAddresses = async () => {
    if (!vault) return

    const chains = ['Bitcoin', 'Ethereum', 'Solana']
    const results: Record<string, string> = {}

    for (const chain of chains) {
      try {
        results[chain] = await vault.address(chain)
      } catch (error) {
        console.error(`Failed to derive ${chain} address:`, error)
      }
    }

    setAddresses(results)
  }

  return (
    <div>
      <h1>Vultisig SDK Demo</h1>

      {!vault && (
        <button onClick={createVault}>
          Create Fast Vault
        </button>
      )}

      {vault && (
        <div>
          <h2>Vault: {vault.name}</h2>
          <p>Local Party: {vault.localPartyId}</p>

          <button onClick={deriveAddresses}>
            Derive Addresses
          </button>

          {Object.keys(addresses).length > 0 && (
            <div>
              <h3>Addresses</h3>
              {Object.entries(addresses).map(([chain, address]) => (
                <div key={chain}>
                  <strong>{chain.toUpperCase()}:</strong> {address}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default VaultApp
```

## Configuration

### SDK Configuration

```typescript
const sdk = new Vultisig({
  autoInit: true, // Automatically initialize WASM modules on creation
  serverUrl: "https://api.vultisig.com", // Custom VultiServer endpoint
  relayUrl: "https://relay.vultisig.com", // Custom relay endpoint
});
```

### WASM Files

The SDK requires three WASM files to be available in your application's public directory:

- `wallet-core.wasm` - Trust Wallet Core for address derivation
- `dkls.wasm` - ECDSA threshold signatures (DKLS protocol)
- `schnorr.wasm` - EdDSA threshold signatures (Schnorr protocol)

For bundled applications (Vite, webpack, etc.), place these files in the `public/` directory.

## API Reference

### Core Methods

#### `initialize(): Promise<void>`

Initialize the SDK and load all WASM modules.

#### `createFastVault(options): Promise<string>`

Create a new vault using VultiServer assistance. Returns the vaultId.

**Parameters:**

- `options.name: string` - Vault name
- `options.email: string` - Email for verification
- `options.password: string` - Vault encryption password

#### `verifyVault(vaultId, code): Promise<FastVault>`

Verify vault creation with email verification code. Returns the verified vault.

#### `createSecureVault(options): Promise<{ vault, vaultId, sessionId }>`

Create a multi-device secure vault with N-of-M threshold signing.

**Parameters:**

- `options.name: string` - Vault name
- `options.devices: number` - Number of devices participating (minimum 2)
- `options.threshold?: number` - Signing threshold (defaults to ceil((devices+1)/2))
- `options.password?: string` - Optional vault encryption password
- `options.onQRCodeReady?: (qrPayload: string) => void` - Called when QR code is ready for device pairing
- `options.onDeviceJoined?: (deviceId: string, total: number, required: number) => void` - Called when a device joins
- `options.onProgress?: (step: VaultCreationStep) => void` - Called with creation progress updates

**Returns:**

- `vault: SecureVault` - The created vault instance
- `vaultId: string` - Unique vault identifier
- `sessionId: string` - Session ID used for creation

#### `validateSeedphrase(mnemonic): Promise<SeedphraseValidation>`

Validate a BIP39 mnemonic phrase.

**Returns:**
- `valid: boolean` - Whether the mnemonic is valid
- `wordCount: number` - Number of words (12 or 24)
- `invalidWords?: string[]` - Words not in BIP39 wordlist
- `error?: string` - Error message if invalid

#### `discoverChainsFromSeedphrase(mnemonic, chains?, onProgress?): Promise<ChainDiscoveryResult[]>`

Discover chains with balances for a seedphrase.

**Parameters:**
- `mnemonic: string` - BIP39 mnemonic phrase
- `chains?: Chain[]` - Chains to scan (defaults to common chains)
- `onProgress?: (progress: ChainDiscoveryProgress) => void` - Progress callback

#### `importSeedphraseAsFastVault(options): Promise<string>`

Import a seedphrase as a FastVault. Returns vaultId for email verification.

**Parameters:**
- `options.mnemonic: string` - BIP39 mnemonic (12 or 24 words)
- `options.name: string` - Vault name
- `options.email: string` - Email for verification
- `options.password: string` - Vault encryption password
- `options.discoverChains?: boolean` - Auto-enable chains with balances
- `options.onProgress?: (step: VaultCreationStep) => void` - Progress callback
- `options.onChainDiscovery?: (progress: ChainDiscoveryProgress) => void` - Discovery callback

#### `importSeedphraseAsSecureVault(options): Promise<{ vault, vaultId, sessionId }>`

Import a seedphrase as a SecureVault with multi-device MPC.

**Parameters:**
- `options.mnemonic: string` - BIP39 mnemonic (12 or 24 words)
- `options.name: string` - Vault name
- `options.devices: number` - Number of participating devices
- `options.threshold?: number` - Signing threshold
- `options.password?: string` - Optional encryption password
- `options.onQRCodeReady?: (qrPayload: string) => void` - QR callback
- `options.onDeviceJoined?: (deviceId, total, required) => void` - Device join callback

#### `vault.address(chain): Promise<string>`

Derive a blockchain address for the given chain (called on Vault instance).

#### `addVault(file, password?): Promise<Vault>`

Import a vault from a backup file.

#### `vault.export(password?): Promise<Blob>`

Export a vault to encrypted backup format as a Blob (called on Vault instance).

#### `vault.exportAsBase64(password?): Promise<string>`

Export a vault to encrypted backup format as a base64 string (called on Vault instance).

#### `secureVault.sign(payload, options?): Promise<SigningResult>`

Sign a transaction with a SecureVault (requires device coordination).

**Parameters:**

- `payload: SigningPayload` - Transaction data to sign
- `options.signal?: AbortSignal` - Optional signal to cancel the signing operation
- `options.onQRCodeReady?: (qrPayload: string) => void` - Called when QR code is ready for device pairing
- `options.onDeviceJoined?: (deviceId: string, total: number, required: number) => void` - Called when a device joins
- `options.onProgress?: (step: SigningStep) => void` - Called with signing progress updates

#### `secureVault.signBytes(options, signingOptions?): Promise<SigningResult>`

Sign arbitrary bytes with a SecureVault.

**Parameters:**

- `options.chain: string` - Chain for signature algorithm selection
- `options.messages: (Uint8Array | Buffer | string)[]` - Messages to sign (hex strings or bytes)
- `signingOptions.signal?: AbortSignal` - Optional signal to cancel the operation

### Utility Methods

#### `isVaultFileEncrypted(file): Promise<boolean>`

Check if a vault backup file is encrypted.

#### `validateVault(vault): VaultValidationResult`

Validate vault structure and integrity.

#### `getVaultDetails(vault): VaultDetails`

Get vault metadata and information.

## Error Handling

The SDK throws descriptive errors that you can catch and handle:

```typescript
try {
  const vault = await sdk.createFastVault({
    name: "Test Vault",
    email: "invalid-email",
    password: "123",
  });
} catch (error) {
  if (error.message.includes("email")) {
    console.error("Invalid email address");
  } else if (error.message.includes("password")) {
    console.error("Password too weak");
  } else {
    console.error("Vault creation failed:", error);
  }
}
```

## Examples

See the `/examples` directory for complete sample applications:

- **Browser Example** - Complete web application with vault creation, import, and address derivation
- **Node.js Example** - Server-side vault operations and blockchain interactions

## Requirements

- Node.js 20+
- Modern browser with WebAssembly support
- Electron 20+ (for desktop applications)
- Network access for VultiServer communication (for Fast Vault features)

## Security Considerations

- **Private Keys**: The SDK uses threshold signatures - private keys are never stored in a single location
- **Encryption**: Vault keyshares are encrypted using AES-GCM with user-provided passwords
- **Server Trust**: Fast Vaults use VultiServer as one party in the MPC protocol
- **Secure Vault Independence**: Secure Vaults only use the relay server for coordination, not signing
- **Configurable Thresholds**: Secure Vaults support custom M-of-N thresholds for multi-party approval
- **WASM Integrity**: Ensure WASM files are served from trusted sources

## Development

### Prerequisites

- Node.js 20+
- Yarn 4.x

### Setup

This SDK is part of a monorepo. **Always install dependencies from the root directory:**

```bash
# Clone the repository
git clone https://github.com/vultisig/vultisig-sdk.git
cd vultisig-sdk

# IMPORTANT: Install from root (sets up all workspace packages)
yarn install
```

### Building

The SDK bundles functionality from workspace packages (`packages/core/` and `packages/lib/`) into a single distributable package.

```bash
# Build the SDK (from root directory)
yarn workspace @vultisig/sdk build
```

This creates the distributable package in `packages/sdk/dist/` with all dependencies bundled.

### Testing

```bash
# Run tests (from root directory)
yarn workspace @vultisig/sdk test
```

### Development Workflow

1. **Make changes** to SDK code in `packages/sdk/src/` or workspace packages in `packages/core/`/`packages/lib/`
2. **Build**: `yarn workspace @vultisig/sdk build`
3. **Test**: `yarn workspace @vultisig/sdk test`
4. **Lint**: `yarn lint` (from root)

### Project Structure

```
packages/sdk/
├── src/                # SDK source code
│   ├── chains/        # Address derivation and chain management
│   ├── mpc/           # Multi-party computation logic
│   ├── vault/         # Vault creation and management
│   ├── server/        # Fast vault server integration
│   └── wasm/          # WASM module management
├── tests/             # Test suite
└── package.json       # SDK package configuration

# Workspace packages (bundled into SDK)
packages/core/         # Core blockchain functionality
packages/lib/          # Shared libraries and utilities
```

## Contributing

1. Fork the repository
2. Install dependencies from root: `yarn install`
3. Make your changes in `packages/sdk/src/` or workspace packages
4. Run tests: `yarn workspace @vultisig/sdk test`
5. Build: `yarn workspace @vultisig/sdk build`
6. Submit a pull request

## License

MIT License - see [LICENSE](./LICENSE) file for details.

## Support

- 📖 [Documentation](https://docs.vultisig.com)
- 💬 [Discord Community](https://discord.gg/vultisig)
- 🐛 [Report Issues](https://github.com/vultisig/vultisig-sdk/issues)
- 🌐 [Website](https://vultisig.com)

---

**Built with ❤️ by the Vultisig team**
