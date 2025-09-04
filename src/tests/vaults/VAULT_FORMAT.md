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

| Field | Type | Description |
|-------|------|-------------|
| `version` | uint64 | Data format version number |
| `is_encrypted` | bool | Whether vault data is password-encrypted |
| `vault` | string | Base64-encoded or encrypted vault data |
| `name` | string | Human-readable vault name |
| `public_key_ecdsa` | string | Hex-encoded compressed secp256k1 public key (66 chars) |
| `public_key_eddsa` | string | Hex-encoded Ed25519 public key (64 chars) |
| `signers` | []string | MPC participant identifiers |
| `created_at` | timestamp | Vault creation time |
| `hex_chain_code` | string | BIP32 chain code for HD derivation (64 chars) |
| `key_shares` | []KeyShare | MPC threshold signature shares |
| `local_party_id` | string | Local participant ID |
| `reshare_prefix` | string | Prefix for key resharing |
| `lib_type` | LibType | MPC library type (GG20 = 0) |


## Encryption Details

When `is_encrypted = true`, the vault data is encrypted using:

- **Algorithm**: AES-256-GCM
- **Key Derivation**: SHA256(password) 
- **Nonce**: First 12 bytes of encrypted data
- **Ciphertext**: Remaining bytes after nonce

## Reading Keyshare Files

### Using the Inspector Script

The `inspect_keyshare.ts` script provides a comprehensive analysis of `.vult` files, displaying vault information, public keys, signers, and key shares in a readable format. The script uses the same protobuf schemas and utilities as the main codebase.

```bash
# Inspect unencrypted keyshare
npx tsx scripts/inspect_keyshare.ts vault.vult

# Inspect encrypted keyshare  
npx tsx scripts/inspect_keyshare.ts vault.vult mypassword123
```

The script automatically detects encryption status and provides detailed error messages for common issues like missing passwords, incorrect passwords, or corrupted files.
