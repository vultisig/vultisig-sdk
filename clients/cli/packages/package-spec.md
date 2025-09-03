# Vultisig CLI Packages Specification

## Overview

The `/packages` directory contains TypeScript integration libraries that provide blockchain-specific signing capabilities for web applications. These packages interface with the Vultisig CLI daemon via Unix socket communication using a JSON-RPC protocol.

## Architecture

### Package Structure

```
packages/
├── vultisig-eth-signer/     # Ethereum signing integration
├── vultisig-btc-signer/     # Bitcoin signing integration  
├── vultisig-sol-signer/     # Solana signing integration
└── examples/                # Integration examples and patterns
```

Each package follows a consistent structure:
- **TypeScript ES modules** with `"type": "module"` in `package.json`
- **Compiled output** in `dist/` directory
- **Consistent API patterns** across all blockchain implementations
- **Chain-specific dependencies** (ethers, bitcoinjs-lib, @solana/web3.js)

### Communication Protocol

**Transport**: Unix Domain Socket at `/tmp/vultisig.sock`
**Protocol**: JSON-RPC over newline-delimited JSON
**Connection Model**: Request-response with connection reuse

## Package Implementations

### 1. vultisig-eth-signer

**Purpose**: Ethereum transaction and message signing
**Dependencies**: `ethers@^6.13.2`

**Key Features**:
- Extends `ethers.AbstractSigner` for seamless integration
- Supports EIP-1559 transactions (Type 2)
- EIP-712 typed data signing
- Address derivation with checksum validation

**API Methods**:
```typescript
class VultisigSigner extends AbstractSigner {
  async getAddress(): Promise<string>
  async signTransaction(tx: TransactionRequest): Promise<string>
  async signTypedData(domain, types, value): Promise<string>
  // signMessage() - not yet implemented
}
```

**JSON-RPC Calls**:
- `get_address`: `{scheme: "ecdsa", curve: "secp256k1", network: "eth"}`
- `sign`: `{scheme: "ecdsa", curve: "secp256k1", network: "eth", messageType: "eth_tx|eth_typed", payload: {...}}`

### 2. vultisig-btc-signer

**Purpose**: Bitcoin PSBT (Partially Signed Bitcoin Transaction) signing
**Dependencies**: `bitcoinjs-lib@^6.1.6`

**Key Features**:
- PSBT-based transaction signing
- secp256k1 ECDSA signatures
- Base64 encoded transaction handling

**API Methods**:
```typescript
class VultisigSigner {
  async signPsbt(psbtBase64: string): Promise<{signedPsbtBase64?: string; finalTxHex?: string}>
}
```

**JSON-RPC Calls**:
- `sign`: `{scheme: "ecdsa", curve: "secp256k1", network: "btc", messageType: "btc_psbt", payload: {psbtBase64}}`

### 3. vultisig-sol-signer

**Purpose**: Solana transaction signing
**Dependencies**: `@solana/web3.js@^1.95.3`

**Key Features**:
- Ed25519 signature scheme
- Raw transaction byte signing
- Base64 encoded payload handling

**API Methods**:
```typescript
class VultisigSigner {
  async getAddress(): Promise<string>
  async sign(bytes: Uint8Array): Promise<string>
}
```

**JSON-RPC Calls**:
- `get_address`: `{scheme: "eddsa", curve: "ed25519", network: "sol"}`
- `sign`: `{scheme: "eddsa", curve: "ed25519", network: "sol", messageType: "sol_tx", payload: {bytes: base64}}`

## CLI Daemon Interface

### Unix Socket Server

**Location**: `/tmp/vultisig.sock`
**Permissions**: `0o660` (user and group read/write)
**Protocol**: Newline-delimited JSON-RPC

### Request/Response Format

**Request**:
```json
{
  "id": 1,
  "method": "get_address|sign",
  "params": {
    "scheme": "ecdsa|eddsa",
    "curve": "secp256k1|ed25519", 
    "network": "eth|btc|sol|...",
    "messageType": "eth_tx|eth_typed|btc_psbt|sol_tx",
    "payload": { /* network-specific data */ },
    "policyContext": {}
  }
}
```

**Response**:
```json
{
  "id": 1,
  "result": {
    "address": "0x...",
    "pubkey": "...",
    "signature": "...",
    "raw": "..."
  },
  "error": {
    "message": "error description"
  }
}
```

### Daemon Implementation

The CLI daemon (`vultisig run`) implements:
1. **Unix socket listener** at `/tmp/vultisig.sock`
2. **JSON-RPC request handler** for vault operations
3. **MPC coordination** for threshold signatures
4. **Vault management** via SDK integration

## Integration Patterns

### 1. Ethers.js Integration

```typescript
import { JsonRpcProvider } from "ethers";
import { VultisigSigner } from "vultisig-eth-signer";

const provider = new JsonRpcProvider("https://sepolia.infura.io/v3/...");
const signer = new VultisigSigner(provider);

// Use like any ethers signer
const tx = await signer.sendTransaction({
  to: "0x...",
  value: ethers.parseEther("0.1")
});
```

### 2. Bitcoin PSBT Signing

```typescript
import { VultisigSigner } from "vultisig-btc-signer";

const signer = new VultisigSigner();
const result = await signer.signPsbt(psbtBase64);
```

### 3. Solana Transaction Signing

```typescript
import { VultisigSigner } from "vultisig-sol-signer";

const signer = new VultisigSigner();
const signature = await signer.sign(transactionBytes);
```

## Development Workflow

### Package Development

1. **Build packages**: `npm run build` in each package directory
2. **Type checking**: TypeScript with strict mode enabled
3. **Testing**: Integration tests with running daemon
4. **Publishing**: Private packages for internal use

### Daemon Integration

1. **Start daemon**: `vultisig run --vault /path/to/vault.vult`
2. **Verify socket**: Check `/tmp/vultisig.sock` exists
3. **Test requests**: Use packages or direct JSON-RPC calls

### Example Integration

The `packages/examples/` directory demonstrates:
- **Hardhat integration** with custom signer
- **Transaction examples** for each blockchain
- **Error handling** patterns
- **Connection management** best practices

## Security Considerations

### Socket Security
- Unix socket permissions restrict access to user/group
- No network exposure of signing operations
- Process isolation between daemon and clients

### Cryptographic Security
- MPC 2-of-2 threshold signatures
- Mobile app co-signing requirement
- No private key exposure to packages

### Request Validation
- JSON-RPC parameter validation in daemon
- Network-specific payload verification
- Signature scheme enforcement per blockchain

## Error Handling

### Common Error Patterns

1. **Connection Errors**: Socket unavailable or daemon not running
2. **Validation Errors**: Invalid parameters or payload format
3. **MPC Errors**: Mobile co-signing failures or timeouts
4. **Network Errors**: Blockchain-specific validation failures

### Error Response Format

```json
{
  "id": 1,
  "error": {
    "message": "Human-readable error description",
    "code": -32600  // JSON-RPC error codes
  }
}
```

## Future Extensions

### Additional Blockchains
- Consistent package structure for new chains
- Standardized signing parameter patterns
- Unified error handling across packages

### Enhanced Features
- Batch transaction signing
- Hardware wallet integration
- Policy-based signing controls
- Multi-signature coordination

## Dependencies and Requirements

### Runtime Requirements
- **Node.js**: ES modules support (Node 14+)
- **Daemon**: Vultisig CLI running with vault loaded
- **Socket**: Unix domain socket at `/tmp/vultisig.sock`

### Build Requirements
- **TypeScript**: ^5.5.4 with strict configuration
- **Chain Libraries**: ethers, bitcoinjs-lib, @solana/web3.js
- **Node Types**: @types/node for Unix socket support

## Conclusion

The packages architecture provides a clean, type-safe interface between web applications and the Vultisig MPC signing daemon. The consistent API patterns, robust error handling, and security-focused design enable seamless integration across multiple blockchain networks while maintaining the security properties of threshold signatures.
