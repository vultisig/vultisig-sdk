# Fast Signing Implementation

## Overview

The VultisigSDK now supports fast signing with the `.sign("fast")` method. This allows fast vaults (vaults with VultiServer participation) to sign transactions using server-assisted signing.

## Usage

### Basic Fast Signing

```typescript
import { Vultisig } from 'vultisig-sdk'

// Initialize SDK
const vultisig = new Vultisig()

// Import or create a fast vault
const vault = await vultisig.addVault(fastVaultFile, password)

// Create signing payload
const signingPayload = {
  transaction: {
    to: '0x742d35Cc6634C0532925a3b8D8C4f8de4c8e8e2f',
    value: '1000000000000000000', // 1 ETH in wei
    gasPrice: '20000000000', // 20 Gwei
    gasLimit: '21000',
    nonce: 42
  },
  chain: 'ethereum'
}

// Sign using fast mode
const signature = await vault.sign('fast', signingPayload)

console.log('Signature:', signature.signature)
console.log('Format:', signature.format) // 'ECDSA' or 'EdDSA'
```

### Advanced Usage with Pre-computed Hashes

```typescript
// For advanced use cases, provide pre-computed message hashes
const signingPayload = {
  transaction: { /* transaction data */ },
  chain: 'bitcoin',
  messageHashes: [
    'a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890',
    'b2c3d4e5f6789012345678901234567890123456789012345678901234567890a1'
  ]
}

const signature = await vault.sign('fast', signingPayload)
```

## Types

### SigningMode

```typescript
type SigningMode = 'fast' | 'relay' | 'local'
```

- `'fast'`: Server-assisted signing (VultiServer)
- `'relay'`: Multi-party signing via relay (not implemented)
- `'local'`: Local signing (not implemented)

### SigningPayload

```typescript
type SigningPayload = {
  transaction: any // Chain-specific transaction data
  chain: any // Chain identifier
  derivePath?: string // Optional derivation path
  messageHashes?: string[] // Pre-computed message hashes
}
```

### Signature

```typescript
type Signature = {
  signature: string // Hex-encoded signature
  recovery?: number // Recovery parameter (for ECDSA)
  format: 'DER' | 'ECDSA' | 'EdDSA' // Signature format
}
```

## Vault Requirements

### Fast Vaults

Fast signing is only available for fast vaults, which have the following characteristics:

- Contains at least one signer with `Server-` prefix (e.g., `Server-5678`)
- Created using VultiServer as a participant
- Supports server-assisted signing operations

### Secure Vaults

Secure vaults (traditional multi-party vaults) cannot use fast signing:

- All signers are devices (e.g., `device-1234`, `browser-5678`)
- No `Server-` prefix in signer list
- Requires multi-party coordination for signing

## Error Handling

### Vault Type Validation

```typescript
try {
  await secureVault.sign('fast', payload)
} catch (error) {
  // VaultError: Fast signing is only available for fast vaults
}
```

### Mode Validation

```typescript
try {
  await fastVault.sign('relay', payload)
} catch (error) {
  // VaultError: Relay signing is only available for secure vaults
}
```

### Not Implemented Modes

```typescript
try {
  await vault.sign('local', payload)
} catch (error) {
  // VaultError: Local signing not implemented yet
}
```

## Implementation Details

### Architecture

1. **Vault.sign()** - Main entry point with mode validation
2. **ServerManager.signWithServer()** - Coordinates server communication
3. **FastVaultClient.signWithServer()** - Handles VultiServer API calls
4. **Message Hash Preparation** - Converts transactions to signable hashes
5. **Chain-Specific Processing** - Handles ECDSA vs EdDSA algorithms

### Supported Chains

The implementation supports all chains with appropriate algorithm detection:

- **ECDSA Chains**: Bitcoin, Ethereum, THORChain, Cosmos, etc.
- **EdDSA Chains**: Solana, Sui, TON

### Server Communication

Fast signing communicates with VultiServer using:

- **Endpoint**: `POST /vault/sign`
- **Authentication**: Vault password and encryption keys
- **Message Format**: Hex-encoded transaction hashes
- **Response**: Server-generated signature

## Testing

Comprehensive tests are available in:

- `src/tests/fast-signing.test.ts` - Core functionality tests
- `src/tests/fast-signing-example.test.ts` - Usage examples

Run tests with:

```bash
yarn workspace @vultisig/sdk test tests/fast-signing
```

## Migration from Legacy API

### Before (Deprecated)

```typescript
// Old API - deprecated
await vault.signTransaction(transaction, 'ethereum')
```

### After (New API)

```typescript
// New API - recommended
await vault.sign('fast', {
  transaction,
  chain: 'ethereum'
})
```

The legacy `signTransaction()` method still works for fast vaults but will show deprecation warnings.

## Limitations

1. **Fast Mode Only**: Currently only fast signing is implemented
2. **Server Dependency**: Requires VultiServer connectivity
3. **Password Management**: Vault password handling needs improvement
4. **Chain Support**: Limited to chains supported by VultiServer

## Future Enhancements

- [ ] Implement relay signing mode
- [ ] Implement local signing mode  
- [ ] Improve password management
- [ ] Add signature verification
- [ ] Support custom derivation paths
- [ ] Add transaction broadcasting integration
