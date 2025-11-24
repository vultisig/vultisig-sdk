# Vultisig Keyshare Format Documentation

This document explains the structure and format of Vultisig keyshare files (`.vult`).

## Overview

Vultisig keyshare files use a layered approach with base64 encoding and Protocol Buffers (protobuf) serialization to store multi-party computation (MPC) threshold signature keyshares.

## File Structure

```
.vult file
├── Base64 encoding (outer layer)
└── VaultContainer (protobuf)
    ├── version: uint64
    ├── is_encrypted: bool
    └── vault: string
        ├── Base64 encoding (if unencrypted)
        ├── OR AES-256-GCM encryption (if encrypted)
        └── Vault (protobuf)
            ├── name: string
            ├── public_key_ecdsa: string (hex)
            ├── public_key_eddsa: string (hex)
            ├── signers: []string
            ├── created_at: timestamp
            ├── hex_chain_code: string (hex)
            ├── key_shares: []KeyShare
            ├── local_party_id: string
            ├── reshare_prefix: string
            └── lib_type: LibType
```

## Protocol Buffer Definitions

### VaultContainer

```protobuf
message VaultContainer {
  // version of data format
  uint64 version = 1;
  // vault contained the container
  string vault = 2;
  // is vault encrypted with password
  bool is_encrypted = 3;
}
```

### Vault

```protobuf
message Vault {
  string name = 1;
  string public_key_ecdsa = 2;
  string public_key_eddsa = 3;
  repeated string signers = 4;
  google.protobuf.Timestamp created_at = 5;
  string hex_chain_code = 6;
  repeated KeyShare key_shares = 7;
  string local_party_id = 8;
  string reshare_prefix = 9;
  vultisig.keygen.v1.LibType lib_type = 10;
}
```

### KeyShare

```protobuf
message KeyShare {
  string public_key = 1;
  string keyshare = 2;
}
```

## Field Descriptions

| Field              | Type       | Description                                            |
| ------------------ | ---------- | ------------------------------------------------------ |
| `version`          | uint64     | Data format version number                             |
| `is_encrypted`     | bool       | Whether vault data is password-encrypted               |
| `vault`            | string     | Base64-encoded or encrypted vault data                 |
| `name`             | string     | Human-readable vault name                              |
| `public_key_ecdsa` | string     | Hex-encoded compressed secp256k1 public key (66 chars) |
| `public_key_eddsa` | string     | Hex-encoded Ed25519 public key (64 chars)              |
| `signers`          | []string   | MPC participant identifiers                            |
| `created_at`       | timestamp  | Vault creation time                                    |
| `hex_chain_code`   | string     | BIP32 chain code for HD derivation (64 chars)          |
| `key_shares`       | []KeyShare | MPC threshold signature shares                         |
| `local_party_id`   | string     | Local participant ID                                   |
| `reshare_prefix`   | string     | Prefix for key resharing                               |
| `lib_type`         | LibType    | MPC library type (GG20 = 0)                            |

## Supported Blockchain Networks

### ECDSA-based Networks

The `public_key_ecdsa` field enables support for:

| Network             | Symbol | Derivation Path     |
| ------------------- | ------ | ------------------- |
| Ethereum            | ETH    | `m/44'/60'/0'/0/0`  |
| Bitcoin             | BTC    | `m/84'/0'/0'/0/0`   |
| THORChain           | RUNE   | `m/44'/931'/0'/0/0` |
| Cosmos              | ATOM   | `m/44'/118'/0'/0/0` |
| Binance Smart Chain | BSC    | `m/44'/60'/0'/0/0`  |

### EdDSA-based Networks

The `public_key_eddsa` field enables support for:

| Network | Symbol | Derivation Path    |
| ------- | ------ | ------------------ |
| Solana  | SOL    | `m/44'/501'/0'/0'` |

## Encryption Details

When `is_encrypted = true`, the vault data is encrypted using:

- **Algorithm**: AES-256-GCM
- **Key Derivation**: SHA256(password)
- **Nonce**: First 12 bytes of encrypted data
- **Ciphertext**: Remaining bytes after nonce

## Reading Keyshare Files

### Using the Inspector Script

```bash
# Inspect unencrypted keyshare
node scripts/inspect_keyshare.js vault.vult

# Inspect encrypted keyshare
node scripts/inspect_keyshare.js vault.vult mypassword123
```

### Using Rust (vultisigd)

```rust
use vultisigd::keyshare::VultKeyshare;

// Read file
let content = std::fs::read_to_string("vault.vult")?;

// Parse keyshare (with optional password)
let keyshare = VultKeyshare::from_base64_with_password(&content, Some("password"))?;

// Derive addresses
let eth_addr = keyshare.derive_eth_address()?;
let btc_addr = keyshare.derive_btc_address()?;
let sol_addr = keyshare.derive_sol_address()?;
```

### Using Node.js (manual)

```javascript
const fs = require("fs");

// Read and decode outer base64
const content = fs.readFileSync("vault.vult", "utf8");
const decoded = Buffer.from(content.trim(), "base64");

// Parse VaultContainer protobuf
const container = parseVaultContainer(decoded);

if (!container.is_encrypted) {
  // Decode inner vault
  const vaultData = Buffer.from(container.vault, "base64");
  const vault = parseVault(vaultData);

  console.log("Vault name:", vault.name);
  console.log("ECDSA key:", vault.public_key_ecdsa);
  console.log("EdDSA key:", vault.public_key_eddsa);
}
```

## Key Derivation

Vultisig uses TSS (Threshold Signature Scheme) compatible HD key derivation:

1. **Master Keys**: Stored in `public_key_ecdsa`/`public_key_eddsa` fields
2. **Chain Code**: Stored in `hex_chain_code` field
3. **Derivation**: Uses `TssGetDerivedPubKey()` function
4. **Paths**: Standard BIP44/BIP84 derivation paths per network

The derived addresses are deterministic and match those generated by the Vultisig mobile app.

## Security Considerations

- **Keyshare Protection**: The actual private key shares in `key_shares[].keyshare` are encrypted
- **Password Security**: Use strong passwords for encrypted vaults
- **Threshold Security**: Requires multiple parties to sign transactions
- **HD Derivation**: Each network uses isolated derivation paths

## File Location

Keyshare files are typically stored in:

- **macOS/Linux**: `~/.vultisigd/keyshares/`
- **File Extension**: `.vult`

## Tools

- **Inspector**: `scripts/inspect_keyshare.js` - Analyze keyshare structure
- **CLI**: `vultisigd` - Run signing daemon with keyshare
- **Packages**: Various npm packages for signing integration

## Example Output

```
🔍 Vultisig Keyshare Inspector
================================
File: ~/.vultisigd/keyshares/my_vault.vult

📋 Raw Content Analysis:
  Content length: 2847 characters
  Base64 format: ✅ Valid
  ✅ Valid base64, decoded to 2048 bytes

📦 VaultContainer Analysis:
  ✅ Version: 1
  🔒 Is Encrypted: false
  📄 Vault Data: 1876 bytes

🏛️ Inner Vault Analysis:
  name: "My Vultisig Vault"
  📈 ECDSA Public Key: 0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
    🌐 Supports: Ethereum, Bitcoin, THORChain, Cosmos, BSC
  📊 EdDSA Public Key: 1234567890123456789012345678901234567890123456789012345678901234
    🌐 Supports: Solana
  🔗 Chain Code: 873DFF81C02F525623FD1FE5167EAC3A55A049DE3D314BB42EE227FFED37D508
```

This format enables secure, multi-party threshold signatures across multiple blockchain networks while maintaining compatibility with standard HD wallet derivation paths.
