# Vault Types Guide

## Overview

Vultisig offers two vault types, each optimized for different use cases.

## FastVault

**Architecture**: 2-of-2 threshold (your device + VultiServer)

```
┌─────────────┐     MPC      ┌──────────────┐
│ Your Device │◄────────────►│ VultiServer  │
│  (1 share)  │   Signing    │  (1 share)   │
└─────────────┘              └──────────────┘
```

**Properties:**
- Threshold: 2-of-2 (fixed)
- Encryption: Always encrypted (password required)
- Signing: Fast (server-assisted)
- Setup: Email verification required

**Best for:**
- AI agents and bots
- Automated trading
- Single-user wallets
- Quick operations

**Create FastVault:**
```bash
vultisig create fast \
  --name "agent-wallet" \
  --email "agent@example.com" \
  --password "SecurePassword123!"
```

## SecureVault

**Architecture**: N-of-M threshold (multiple devices, no server)

```
┌──────────┐
│ Device 1 │──┐
│ (share)  │  │
└──────────┘  │    ┌─────────────┐
              ├───►│ Relay Server│  (coordination only,
┌──────────┐  │    │ (no keys)   │   no key material)
│ Device 2 │──┤    └─────────────┘
│ (share)  │  │
└──────────┘  │
              │
┌──────────┐  │
│ Device 3 │──┘
│ (share)  │
└──────────┘
```

**Properties:**
- Threshold: Configurable (default: ceil(n*2/3))
- Encryption: Optional
- Signing: Requires device coordination via QR code
- Setup: Multi-device keygen ceremony

**Best for:**
- Team treasuries
- High-value assets
- Maximum security requirements
- Cold storage

**Create SecureVault:**
```bash
vultisig create secure \
  --name "team-treasury" \
  --shares 3 \
  --threshold 2
# Displays QR code for other devices to scan
```

## Comparison Table

| Feature | FastVault | SecureVault |
|---------|-----------|-------------|
| **Threshold** | 2-of-2 (fixed) | N-of-M (configurable) |
| **Signing Speed** | Fast (server-assisted) | Requires device coordination |
| **Server Dependency** | Yes (VultiServer) | No (relay only) |
| **Password** | Required | Optional |
| **Multi-Device** | No | Yes |
| **Automation** | Excellent | Limited |
| **Setup Time** | Quick (email verification) | Varies (device coordination) |
| **Trust Model** | Device + Server | Distributed devices |

## Decision Matrix

| Scenario | Recommended | Reason |
|----------|-------------|--------|
| AI agent automation | **FastVault** | Instant signing, no coordination |
| Trading bot | **FastVault** | Speed critical |
| Personal wallet | **FastVault** | Simple setup |
| Company treasury | **SecureVault** | Multi-signature security |
| >$100k holdings | **SecureVault** | Maximum security |
| Team access needed | **SecureVault** | Multiple signers |
| Cold storage | **SecureVault** | No server dependency |

## Threshold Examples (SecureVault)

| Devices | Default Threshold | Meaning |
|---------|-------------------|---------|
| 2 | 2-of-2 | Both devices required |
| 3 | 2-of-3 | Any 2 of 3 can sign |
| 4 | 3-of-4 | Any 3 of 4 can sign |
| 5 | 4-of-5 | Any 4 of 5 can sign |

## Security Comparison

### FastVault Security
- **Pros**: VultiServer never has full key, instant revocation possible
- **Cons**: Requires server availability, trust in Vultisig infrastructure

### SecureVault Security
- **Pros**: No single point of failure, fully self-sovereign
- **Cons**: Lost devices can lock funds (below threshold), coordination overhead

## Key Shares Explained

Each vault share contains cryptographic key material for multiple signature algorithms:

| Algorithm | Purpose | Used By |
|-----------|---------|---------|
| **ECDSA** | Signing on Bitcoin, Ethereum, and most chains | All chains except EdDSA-only |
| **EdDSA** | Signing on Solana, Polkadot, Sui, etc. | Ed25519-based chains |
| **ML-DSA** | Post-quantum signature scheme | Future-proofing against quantum attacks |

### Where Shares Are Stored

- **FastVault**: Your share is in an encrypted `.vult` file on disk (at `~/.vultisig/vaults/`), decrypted with your vault password at signing time. The server's share lives on VultiServer infrastructure.
- **SecureVault**: Each device stores its share locally. There is no central copy.

### How Signing Works

1. A transaction is prepared (recipient, amount, chain)
2. The transaction is hashed into a message to sign
3. MPC protocol runs between share holders (device ↔ server for FastVault, device ↔ device for SecureVault)
4. Each party contributes their share to produce a valid signature — without ever revealing their share
5. The signed transaction is broadcast to the blockchain

### Key Point for Agents

Vault shares are **not** the same as "wallet shares" or "pool shares." They are cryptographic key fragments. The vault's blockchain addresses are derived from the combined public key (which is safe to share). Only the private key is split into shares.

## Migration

You cannot directly convert between vault types. To migrate:

1. Create new vault of desired type
2. Transfer assets from old to new vault
3. Delete old vault after confirming transfers

## Recommendation for AI Agents

**Use FastVault** for AI agent operations because:
1. Instant signing enables real-time trading
2. No human coordination required
3. Password can be securely stored in environment
4. Server-assisted but keys are still MPC-split (not custodial)
