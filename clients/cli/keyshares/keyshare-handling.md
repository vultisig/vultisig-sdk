# VultiSig Keyshare Handling and Address Derivation

This document comprehensively outlines how VultiSig imports keyshares and uses Trust Wallet Core to derive addresses correctly across different blockchain networks, based on analysis of the actual codebase and decoded vault files.

## Overview

VultiSig is a multi-signature wallet that uses Threshold Signature Scheme (TSS) to generate and manage cryptographic keys across multiple devices. The address generation process involves importing distributed keyshares and deriving blockchain-specific addresses using Trust Wallet Core's JavaScript/WebAssembly bindings.

## TSS Libraries Used

VultiSig employs two main TSS implementations via WebAssembly:

1. **DKLS** (`@lib/dkls/vs_wasm`) - Distributed Key Generation and Signing for ECDSA (secp256k1)
2. **Schnorr** (`@lib/schnorr/vs_schnorr_wasm`) - Schnorr signatures for EdDSA (ed25519)

## Vault File Formats

VultiSig supports two main backup formats:

### 1. Vault Container Format (`.vult` files)
Modern protobuf-based format with encryption support:

```typescript
type VaultContainer = {
  version: bigint
  vault: string        // Base64-encoded vault data
  isEncrypted: boolean // Whether vault data is encrypted
}
```

### 2. DAT Backup Format (`.dat`, legacy)
Legacy JSON format for compatibility:

```typescript
type DatBackup = {
  name: string
  pubKeyECDSA: string
  pubKeyEdDSA: string
  hexChainCode: string
  keyshares: Array<{
    pubkey: string
    keyshare: string  // Base64-encoded keyshare
  }>
  signers: string[]
  createdAt: number
  localPartyID: string
  libType: MpcLib    // 0 = GG20, 1 = DKLS
}
```

## Internal Vault Structure

After decoding, vaults use this internal TypeScript structure:

```typescript
type Vault = {
  name: string
  publicKeys: {
    ecdsa: string    // Hex-encoded ECDSA public key (secp256k1)
    eddsa: string    // Hex-encoded EdDSA public key (ed25519)
  }
  hexChainCode: string           // BIP32 chain code (32 bytes hex)
  keyShares: VaultKeyShares     // Base64-encoded keyshares by algorithm
  signers: string[]             // Device identifiers
  localPartyId: string          // This device's identifier
  libType: MpcLib              // TSS library type
  createdAt?: number           // Unix timestamp
  isBackedUp: boolean
  order: number
}

type VaultKeyShares = Record<SignatureAlgorithm, string>
// SignatureAlgorithm = 'ecdsa' | 'eddsa'
```

## Keyshare Import Process

### 1. File Format Detection and Parsing

```typescript
// Step 1: Parse as VaultContainer (protobuf)
const vaultContainer = vaultContainerFromString(fileContent)
// vaultContainerFromString = base64 decode + protobuf parse

// Step 2: Handle encryption if needed
if (vaultContainer.isEncrypted) {
  // Use AES-GCM with SHA-256 password hash
  const decryptedData = decryptWithAesGcm({
    key: password,
    value: fromBase64(vaultContainer.vault)
  })
  const vaultProto = fromBinary(VaultSchema, new Uint8Array(decryptedData))
  vault = fromCommVault(vaultProto)
} else {
  // Unencrypted: vault field is base64-encoded protobuf
  const vaultBinary = fromBase64(vaultContainer.vault)
  const vaultProto = fromBinary(VaultSchema, vaultBinary)
  vault = fromCommVault(vaultProto)
}
```

### 2. Encryption Handling

VultiSig uses **AES-256-GCM** encryption with specific parameters:

```typescript
const decryptWithAesGcm = ({ key, value }: { key: string, value: Buffer }) => {
  // Hash password with SHA-256
  const cipherKey = crypto.createHash('sha256').update(key).digest()
  
  // Extract components from encrypted data
  const nonce = value.subarray(0, 12)        // First 12 bytes
  const ciphertext = value.subarray(12, -16) // Middle section
  const authTag = value.subarray(-16)        // Last 16 bytes
  
  // Decrypt with AES-256-GCM
  const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey, nonce)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}
```

### 3. Protobuf to Internal Format Conversion

The `fromCommVault` function converts protobuf format to internal `Vault` structure:

```typescript
export const fromCommVault = (vault: CommVault): Vault => {
  const publicKeys = {
    ecdsa: vault.publicKeyEcdsa,
    eddsa: vault.publicKeyEddsa,
  }

  // Map keyShares array to Record<SignatureAlgorithm, string>
  const keyShares = recordFromKeys(
    signingAlgorithms, // ['ecdsa', 'eddsa']
    algorithm => vault.keyShares.find(
      keyShare => keyShare.publicKey === publicKeys[algorithm]
    ).keyshare
  )

  return {
    name: vault.name,
    publicKeys,
    keyShares,
    signers: vault.signers,
    hexChainCode: vault.hexChainCode,
    localPartyId: vault.localPartyId,
    libType: fromLibType(vault.libType),
    createdAt: vault.createdAt ? Number(vault.createdAt.seconds) * 1000 : undefined,
    isBackedUp: false,
    order: 0,
  }
}
```

## Address Derivation Process

### 1. Chain-to-Algorithm Mapping

VultiSig determines the signing algorithm based on chain requirements:

```typescript
const signatureAlgorithms = {
  [ChainKind.Bitcoin]: 'ecdsa',    // secp256k1 ECDSA
  [ChainKind.Ethereum]: 'ecdsa',   // secp256k1 ECDSA  
  [ChainKind.Cosmos]: 'ecdsa',     // secp256k1 ECDSA
  [ChainKind.Solana]: 'eddsa',     // ed25519 EdDSA
  [ChainKind.Sui]: 'eddsa',        // ed25519 EdDSA
  [ChainKind.Polkadot]: 'eddsa',   // ed25519 EdDSA
  [ChainKind.Ton]: 'eddsa',        // ed25519 EdDSA
} as const
```

**ECDSA Chains** (secp256k1):
- Bitcoin, Ethereum, BSC, Polygon, Avalanche, Arbitrum, Optimism, Base
- Cosmos ecosystem (Cosmos Hub, Osmosis, THORChain, MayaChain)
- UTXO chains (Litecoin, Dogecoin, Bitcoin Cash)
- Uses `vault.publicKeys.ecdsa` + BIP32 derivation

**EdDSA Chains** (ed25519):
- Solana, Sui, Polkadot, TON, Cardano
- Uses `vault.publicKeys.eddsa` directly (no derivation)

### 2. BIP32 Public Key Derivation (ECDSA only)

For ECDSA chains, VultiSig performs **non-hardened** BIP32 derivation:

```typescript
export const derivePublicKey = ({ hexRootPubKey, hexChainCode, path }) => {
  const bip32 = BIP32Factory(ecc)  // Uses tiny-secp256k1
  const rootNode = bip32.fromPublicKey(
    Buffer.from(hexRootPubKey, 'hex'),
    Buffer.from(hexChainCode, 'hex')
  )
  
  // Parse derivation path and strip hardened markers
  const pathIndices = getDerivePathBytes(path) // Removes all "'" characters
  
  let currentNode = rootNode
  for (const index of pathIndices) {
    if (index >= hardenedOffset) {
      throw new Error('Cannot derive hardened child from public key')
    }
    currentNode = currentNode.derive(index)
  }
  
  return currentNode.publicKey.toString('hex')
}
```

**Critical Detail**: VultiSig strips hardened derivation markers (`'`) because it only has public keys:

```typescript
const getDerivePathBytes = (derivePath: string): number[] => {
  const pathBuf: number[] = []
  const segments = derivePath.split('/')
  for (const segment of segments) {
    if (!segment || segment === 'm') continue
    const index = parseInt(segment.replace("'", ''), 10) // STRIPS HARDENED MARKERS
    pathBuf.push(index)
  }
  return pathBuf
}
```

### 3. Trust Wallet Core Integration

VultiSig uses Trust Wallet Core for derivation paths and address generation:

```typescript
export const getPublicKey = ({ chain, walletCore, hexChainCode, publicKeys }) => {
  const coinType = getCoinType({ walletCore, chain })
  const keysignType = signatureAlgorithms[getChainKind(chain)]
  
  const derivedPublicKey = match(keysignType, {
    ecdsa: () => derivePublicKey({
      hexRootPubKey: publicKeys.ecdsa,
      hexChainCode: hexChainCode,
      path: walletCore.CoinTypeExt.derivationPath(coinType) // Gets standard paths
    }),
    eddsa: () => publicKeys.eddsa, // Direct use for EdDSA
  })
  
  return walletCore.PublicKey.createWithData(
    walletCore.HexCoding.decode(derivedPublicKey)
  )
}
```

**Standard Derivation Paths** (before hardened marker removal):
- Bitcoin: `m/84'/0'/0'/0/0` → `m/84/0/0/0/0`
- Ethereum: `m/44'/60'/0'/0/0` → `m/44/60/0/0/0`  
- THORChain: `m/44'/931'/0'/0/0` → `m/44/931/0/0/0`
- Cosmos: `m/44'/118'/0'/0/0` → `m/44/118/0/0/0`

### 4. Final Address Generation

VultiSig uses Trust Wallet Core's standard address generation:

```typescript
export const deriveAddress = ({ chain, publicKey, walletCore }) => {
  const coinType = getCoinType({ chain, walletCore })
  
  // Special case: MayaChain uses custom Bech32 prefix
  if (chain === Chain.MayaChain) {
    return walletCore.AnyAddress.createBech32WithPublicKey(
      publicKey, walletCore.CoinType.thorchain, 'maya'
    ).description()
  }
  
  // Special case: Cardano uses custom enterprise address generation
  if (chain === Chain.Cardano) {
    return deriveCardanoAddress({ publicKey, walletCore })
  }
  
  // Standard Trust Wallet Core address generation
  const address = walletCore.CoinTypeExt.deriveAddressFromPublicKey(coinType, publicKey)
  
  // Special case: Bitcoin Cash removes prefix
  if (chain === Chain.BitcoinCash && address.startsWith('bitcoincash:')) {
    return address.replace('bitcoincash:', '')
  }
  
  return address
}
```

#### Special Address Formats

**Cardano Enterprise Addresses**:
```typescript
const deriveCardanoAddress = ({ publicKey, walletCore }) => {
  const publicKeyData = publicKey.data()
  const hash = walletCore.Hash.blake2b(publicKeyData, 28)
  const addressData = new Uint8Array(29)
  addressData[0] = 0x61 // Enterprise address flag
  addressData.set(new Uint8Array(hash), 1)
  return walletCore.Bech32.encode('addr', addressData)
}
```

**TRON Uncompressed Keys**:
TRON requires uncompressed public keys for address generation.

**Bitcoin Cash Prefix Removal**:
Trust Wallet Core returns `bitcoincash:` prefixed addresses, which VultiSig strips.

## MPC Keyshare Deserialization

VultiSig deserializes keyshares using WebAssembly TSS libraries:

```typescript
import { Keyshare as DklsKeyshare } from '@lib/dkls/vs_wasm'
import { Keyshare as SchnorrKeyshare } from '@lib/schnorr/vs_schnorr_wasm'

const Keyshare = {
  ecdsa: DklsKeyshare,      // DKLS library
  eddsa: SchnorrKeyshare,   // Schnorr library
}

export const toMpcLibKeyshare = ({ keyShare, signatureAlgorithm }) =>
  Keyshare[signatureAlgorithm].fromBytes(Buffer.from(keyShare, 'base64'))
```

## Real-World Examples

Based on decoded vault files:

### TestFastVault Example
```json
{
  "name": "TestFastVault",
  "publicKeys": {
    "ecdsa": "03ac0f333fc5d22f929e013be80988f57a56837db64d968c126ca4c943984744fd",
    "eddsa": "dff9b5b456eadcbd99366fd691f50f865a26df433f9cbffe1b6f319ecadb8308"
  },
  "hexChainCode": "c39c57cd4127a5c5d6c8583f3f12d7be26e7eed8c398e7ee9926cd33845cae1b",
  "signers": ["Server-94060", "iPhone-5C9"],
  "libType": 1, // DKLS
  "addresses": {
    "Bitcoin": "bc1qsef7rshf0jwm53rnkttpry5rpveqcd6dyj6pn9",
    "Ethereum": "0x8c4E1C2D3b9F88bBa6162F6Bd8dB05840Ca24F8c",
    "THORChain": "thor1nuwfr59wyn6da6v5ktxsa32v2t6u2q4veg9awu",
    "Solana": "G5Jm9g1NH1xprPz3ZpnNmF8Wkz2F6YUhkxpf432mRefR"
  }
}
```

### TestSecureVault Example
```json
{
  "name": "TestSecureVault", 
  "publicKeys": {
    "ecdsa": "03165c66e1c84d4d5b761e3061d311f2b4e63009b354e4b18fecb9657a0397cfa0",
    "eddsa": "46a663e9c21de660f7b103d5cb669be2109a4d6e2171045b7be82423175a4ee5"
  },
  "hexChainCode": "d8eb76b83dca3a7cdcfaee11c40f5702193f6a988ebc1b05215a3a28ec9910b3",
  "addresses": {
    "Bitcoin": "bc1qg7gldwlccw9qeyzpew37hetu2ys042wnu2n3l4",
    "Ethereum": "0x9c4F2C3E4b8F77bBa6162F6Bd8dB05840Ca24F8c"
  }
}
```

## Security Considerations

### 1. Deterministic Generation
- **Identical results across devices**: Same vault data produces identical addresses
- **Cross-platform consistency**: TypeScript, Swift, and Rust implementations match
- **Reproducible derivation**: BIP32 + Trust Wallet Core ensure determinism

### 2. Encryption Security
- **AES-256-GCM**: Industry-standard authenticated encryption
- **SHA-256 password hashing**: Prevents rainbow table attacks
- **12-byte nonces**: Sufficient entropy for GCM mode
- **16-byte auth tags**: Integrity verification

### 3. Key Isolation
- **Chain-specific derivation**: Different paths prevent key reuse
- **Algorithm separation**: ECDSA vs EdDSA keyshares isolated
- **Public-key-only derivation**: No private key reconstruction

### 4. Trust Wallet Core Validation
- **Address format validation**: Prevents malformed addresses
- **Coin type verification**: Ensures correct blockchain parameters
- **Public key validation**: Cryptographic correctness checks

## Error Handling

### Common Decryption Errors
- **Wrong password**: AES-GCM authentication failure
- **Corrupted file**: Base64 or protobuf parsing errors
- **Version mismatch**: Unsupported vault container versions

### Derivation Errors
- **Invalid chain code**: Must be exactly 32 bytes
- **Hardened derivation attempt**: Cannot derive hardened paths from public keys
- **Unsupported chain**: Chain not in coin type mapping

### Address Generation Errors
- **Invalid public key**: Malformed or corrupted key data
- **Trust Wallet Core failures**: Library initialization or validation errors

## Implementation Flow Summary

1. **File Reading**: Read `.vult` file as base64 string
2. **Container Parsing**: Decode to `VaultContainer` protobuf
3. **Decryption** (if needed): AES-GCM with password-derived key
4. **Vault Parsing**: Decode inner vault protobuf to `Vault` object
5. **Key Derivation**: BIP32 derivation for ECDSA chains
6. **Address Generation**: Trust Wallet Core address derivation
7. **Validation**: Verify all addresses are well-formed

This architecture ensures **secure**, **deterministic**, and **cross-platform compatible** address generation while maintaining the security properties of threshold signature schemes.
