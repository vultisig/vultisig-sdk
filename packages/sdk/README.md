# VultisigSDK

> **⚠️ Beta Release**: This SDK is currently in beta. APIs may change before the stable 1.0 release.

A TypeScript SDK for secure multi-party computation (MPC) and blockchain operations using the Vultisig protocol. Build secure, decentralized applications with threshold signature schemes and multi-chain support.

## Features

- 🔐 **Multi-Party Computation (MPC)** - Secure threshold signatures using DKLS and Schnorr protocols
- 🏦 **Fast Vault Creation** - Server-assisted vault generation for single-device usage
- 🌐 **Multi-Chain Support** - Bitcoin, Ethereum, Solana, THORChain, and 30+ blockchains
- 🔗 **Address Derivation** - Generate addresses across multiple blockchain networks
- 📱 **Cross-Platform** - Works in browsers, Node.js, and React applications
- 🔒 **Vault Management** - Import, export, encrypt, and decrypt vault keyshares
- 🌍 **WASM Integration** - High-performance cryptographic operations via WebAssembly

## Installation

```bash
npm install vultisig-sdk
```

### Peer Dependencies

The SDK requires React 18+ if you're using it in a React application:

```bash
npm install react@^18.0.0 react-dom@^18.0.0
```

## Quick Start

### 1. Initialize the SDK

```typescript
import { VultisigSDK } from 'vultisig-sdk'

const sdk = new VultisigSDK()

// Initialize WASM modules
await sdk.initialize()
```

### 2. Create a Fast Vault (Server-Assisted)

```typescript
// Create a new vault using VultiServer
const { vault, vaultId, verificationRequired } = await sdk.createFastVault({
  name: 'My Secure Wallet',
  email: 'user@example.com',
  password: 'SecurePassword123!'
})

if (verificationRequired) {
  // User will receive a 4-digit code via email
  const code = '1234' // Get from user input
  await sdk.verifyVaultEmail(vaultId, code)
  
  // Retrieve the complete vault after verification
  const verifiedVault = await sdk.getVault(vaultId, 'SecurePassword123!')
}
```

### 3. Derive Blockchain Addresses

```typescript
// Derive addresses for different blockchain networks
const btcAddress = await sdk.deriveAddress(vault, 'bitcoin')
const ethAddress = await sdk.deriveAddress(vault, 'ethereum')
const solAddress = await sdk.deriveAddress(vault, 'solana')

console.log('BTC:', btcAddress) // bc1q...
console.log('ETH:', ethAddress) // 0x...
console.log('SOL:', solAddress) // 9WzD...
```

### 4. Import/Export Vaults

```typescript
// Check if a vault file is encrypted
const isEncrypted = await sdk.isVaultFileEncrypted(file)

// Import vault from file
const vault = await sdk.importVaultFromFile(
  file, 
  isEncrypted ? 'password' : undefined
)

// Export vault to backup format
const backup = await sdk.exportVault(vault, {
  includeKeyshares: true,
  password: 'BackupPassword123!'
})
```

## Supported Blockchains

The SDK supports address derivation and operations for 30+ blockchain networks:

| Network | Chain ID | Description |
|---------|----------|-------------|
| Bitcoin | `bitcoin` | Bitcoin mainnet |
| Ethereum | `ethereum` | Ethereum mainnet |
| Solana | `solana` | Solana mainnet |
| THORChain | `thorchain` | THORChain mainnet |
| Polygon | `polygon` | Polygon (MATIC) |
| Avalanche | `avalanche` | Avalanche C-Chain |
| BSC | `bsc` | Binance Smart Chain |
| Arbitrum | `arbitrum` | Arbitrum One |
| Optimism | `optimism` | Optimism mainnet |
| Cosmos | `cosmos` | Cosmos Hub |
| Litecoin | `litecoin` | Litecoin mainnet |
| Dogecoin | `dogecoin` | Dogecoin mainnet |
| ... | ... | And many more |

## React Integration

### Complete Example Component

```typescript
import { VultisigSDK, Vault } from 'vultisig-sdk'
import { useState, useEffect } from 'react'

function VaultApp() {
  const [sdk] = useState(() => new VultisigSDK())
  const [vault, setVault] = useState<Vault | null>(null)
  const [addresses, setAddresses] = useState<Record<string, string>>({})

  useEffect(() => {
    // Initialize SDK on component mount
    sdk.initialize().catch(console.error)
  }, [sdk])

  const createVault = async () => {
    try {
      const result = await sdk.createFastVault({
        name: 'My Wallet',
        email: 'user@example.com',
        password: 'SecurePassword123!'
      })

      if (result.verificationRequired) {
        const code = prompt('Enter 4-digit verification code:')
        await sdk.verifyVaultEmail(result.vaultId, code!)
        const verifiedVault = await sdk.getVault(result.vaultId, 'SecurePassword123!')
        setVault(verifiedVault)
      } else {
        setVault(result.vault)
      }
    } catch (error) {
      console.error('Vault creation failed:', error)
    }
  }

  const deriveAddresses = async () => {
    if (!vault) return

    const chains = ['bitcoin', 'ethereum', 'solana']
    const results: Record<string, string> = {}

    for (const chain of chains) {
      try {
        results[chain] = await sdk.deriveAddress(vault, chain)
      } catch (error) {
        console.error(`Failed to derive ${chain} address:`, error)
      }
    }

    setAddresses(results)
  }

  return (
    <div>
      <h1>VultisigSDK Demo</h1>
      
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
const sdk = new VultisigSDK({
  serverEndpoints: {
    fastVault: 'https://api.vultisig.com',      // VultiServer endpoint
    messageRelay: 'https://relay.vultisig.com'  // Message relay endpoint
  },
  wasmConfig: {
    autoInit: true,  // Automatically initialize WASM modules
    wasmPaths: {
      walletCore: '/wallet-core.wasm',  // Custom WASM paths
      dkls: '/dkls.wasm',
      schnorr: '/schnorr.wasm'
    }
  }
})
```

### WASM Files

The SDK requires three WASM files to be available in your application's public directory:

- `wallet-core.wasm` - Trust Wallet Core for address derivation
- `dkls.wasm` - ECDSA threshold signatures (DKLS protocol)
- `schnorr.wasm` - EdDSA threshold signatures (Schnorr protocol)

For Vite/React applications, place these files in the `public/` directory.

## API Reference

### Core Methods

#### `initialize(): Promise<void>`
Initialize the SDK and load all WASM modules.

#### `createFastVault(options): Promise<{vault, vaultId, verificationRequired}>`
Create a new vault using VultiServer assistance.

**Parameters:**
- `options.name: string` - Vault name
- `options.email: string` - Email for verification
- `options.password: string` - Vault encryption password

#### `verifyVaultEmail(vaultId, code): Promise<boolean>`
Verify vault creation with email verification code.

#### `getVault(vaultId, password): Promise<Vault>`
Retrieve a verified vault from VultiServer.

#### `deriveAddress(vault, chain): Promise<string>`
Derive a blockchain address for the given chain.

#### `importVaultFromFile(file, password?): Promise<Vault>`
Import a vault from a backup file.

#### `exportVault(vault, options?): Promise<VaultBackup>`
Export a vault to backup format.

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
    name: 'Test Vault',
    email: 'invalid-email',
    password: '123'
  })
} catch (error) {
  if (error.message.includes('email')) {
    console.error('Invalid email address')
  } else if (error.message.includes('password')) {
    console.error('Password too weak')
  } else {
    console.error('Vault creation failed:', error)
  }
}
```

## Examples

See the `/examples` directory for complete sample applications:

- **React App** - Complete React application with vault creation, import, and address derivation
- **Node.js Script** - Server-side vault operations and blockchain interactions

## Requirements

- Node.js 18+
- Modern browser with WebAssembly support
- Network access for VultiServer communication (for Fast Vault features)

## Security Considerations

- **Private Keys**: The SDK uses threshold signatures - private keys are never stored in a single location
- **Encryption**: Vault keyshares are encrypted using AES-GCM with user-provided passwords
- **Server Trust**: Fast Vaults use VultiServer as one party in the MPC protocol
- **WASM Integrity**: Ensure WASM files are served from trusted sources

## Development

### Prerequisites

- Node.js 18+
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

The SDK bundles functionality from workspace packages (`core/` and `lib/`) into a single distributable package.

```bash
# Build the SDK (from root directory)
yarn workspace @vultisig/sdk build

# Or using npm scripts (from src/ directory)
cd src && npm run build
```

This creates the distributable package in `src/dist/` with all dependencies bundled.

### Testing

```bash
# Run tests (from root directory)
yarn workspace @vultisig/sdk test

# Or from src/ directory
cd src && npm test
```

### Development Workflow

1. **Make changes** to SDK code in `src/` or workspace packages in `core/`/`lib/`
2. **Build**: `yarn workspace @vultisig/sdk build`
3. **Test**: `yarn workspace @vultisig/sdk test`
4. **Lint**: `yarn lint` (from root)

### Project Structure

```
src/                     # SDK source code
├── chains/             # Address derivation and chain management
├── mpc/               # Multi-party computation logic
├── vault/             # Vault creation and management
├── server/            # Fast vault server integration
├── wasm/              # WASM module management
├── tests/             # Test suite
├── rollup.config.js   # Build configuration
└── package.json       # SDK package configuration

# Workspace packages (bundled into SDK)
../core/               # Core blockchain functionality
../lib/                # Shared libraries and utilities
```

### TODO: Type Definitions Optimization

**Current Approach:** TypeScript's native `tsc` generates type definitions in a distributed structure (one `.d.ts` file per source file). This is memory-efficient and reliable.

**Future Consideration:** For better developer experience, consider implementing [@microsoft/api-extractor](https://api-extractor.com/) to:
- Bundle distributed `.d.ts` files into a single rolled-up declaration file
- Generate API documentation automatically
- Provide API report generation for tracking changes

This would be a post-processing step after `tsc` completes, avoiding the memory issues we experienced with `rollup-plugin-dts`.

## Contributing

1. Fork the repository
2. Install dependencies from root: `yarn install`
3. Make your changes in `src/` or workspace packages
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