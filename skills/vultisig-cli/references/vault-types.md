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
