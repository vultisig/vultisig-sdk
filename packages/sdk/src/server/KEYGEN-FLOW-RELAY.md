# MPC Keygen Flow via Message Relay

This document details the complete MPC key generation process that occurs after the message relay session has been established. This covers the actual cryptographic operations and peer coordination.

## Overview

After the 3-step setup (vault creation, server discovery, session start), the actual MPC key generation begins. This involves both devices (user + VultiServer) coordinating to generate cryptographic keys using WebSocket communication through the message relay server.

## Keygen Steps Sequence

The extension follows a strict 3-step keygen process as defined in `core/mpc/keygen/KeygenStep.ts`:

```typescript
const keygenSteps = ["prepareVault", "ecdsa", "eddsa"] as const;
```

### Step 1: Prepare Vault (`prepareVault`)

**Purpose**: Initialize the keygen session and establish secure communication channels

**Process**:

1. **Session Validation**: Verify all required peers are connected
2. **Parameter Exchange**: Share session parameters (encryption keys, chain codes)
3. **Setup Messages**: Initialize MPC protocol setup data
4. **WebSocket Establishment**: Open persistent connections to relay server

**Relay Endpoints Used**:

- WebSocket connection to: `wss://api.vultisig.com/router/ws/{sessionId}`
- Session status: `GET /router/session/{sessionId}/status`

**Progress**: 50% completion

---

### Step 2: ECDSA Key Generation (`ecdsa`)

**Purpose**: Generate ECDSA keys using DKLS protocol for Bitcoin, Ethereum, etc.

**Process**:

1. **DKLS Initialization**:

   ```typescript
   const dkls = new DKLS(
     { create: true },
     isInitiatingDevice,
     serverUrl,
     sessionId,
     localPartyId,
     signers,
     [],
     encryptionKeyHex,
   );
   ```

2. **Multi-Round Protocol**:
   - **Round 1**: Commitment phase - each party commits to random values
   - **Round 2**: Reveal phase - parties reveal committed values
   - **Round 3**: Key derivation - compute shared public key and individual key shares

3. **Key Validation**: Verify the generated ECDSA public key is valid

4. **Chain Code Generation**: Derive HD wallet chain code for address derivation

**WebSocket Messages**:

- Message type: `"keygen-dkls"`
- Payload: Encrypted MPC protocol messages
- Direction: Bidirectional between user device and VultiServer

**Result**:

- `publicKeyEcdsa`: Public key for ECDSA chains (64 bytes hex)
- `keyshareEcdsa`: Encrypted private key share (stored locally)
- `chainCode`: HD wallet chain code (32 bytes hex)

**Progress**: 70% completion

---

### Step 3: EdDSA Key Generation (`eddsa`)

**Purpose**: Generate EdDSA keys using Schnorr protocol for Solana, some Cosmos chains, etc.

**Process**:

1. **Schnorr Initialization**:

   ```typescript
   const schnorr = new Schnorr(
     { create: true },
     isInitiatingDevice,
     serverUrl,
     sessionId,
     localPartyId,
     signers,
     [],
     encryptionKeyHex,
     dklsSetupMessage,
   );
   ```

2. **Multi-Round Protocol**:
   - **Round 1**: Point commitment phase using Edwards curve
   - **Round 2**: Signature share generation
   - **Round 3**: Aggregation and validation

3. **Cross-Protocol Coordination**: Uses setup message from DKLS for consistency

4. **Key Validation**: Verify EdDSA public key on Ed25519 curve

**WebSocket Messages**:

- Message type: `"keygen-schnorr"`
- Payload: Encrypted Schnorr protocol messages
- Dependency: Requires DKLS completion first

**Result**:

- `publicKeyEddsa`: Public key for EdDSA chains (32 bytes hex)
- `keyshareEddsa`: Encrypted private key share (stored locally)

**Progress**: 90% completion

---

### Step 4: Completion and Finalization

**Purpose**: Finalize the vault and confirm all parties have completed keygen

**Process**:

1. **Vault Assembly**:

   ```typescript
   const vault = {
     name: vaultName,
     publicKeys: { ecdsa: ecdsaPublicKey, eddsa: eddsaPublicKey },
     keyShares: { ecdsa: ecdsaKeyshare, eddsa: eddsaKeyshare },
     signers: [localPartyId, serverPartyId],
     hexChainCode: chainCode,
     createdAt: Date.now(),
   };
   ```

2. **Completion Signaling**:
   - `POST /router/complete/{sessionId}` with local party ID
   - Wait for all parties to signal completion via polling

3. **Final Validation**:
   - Verify all key shares are properly encrypted
   - Validate public key consistency between parties
   - Confirm vault can derive addresses correctly

**Progress**: 100% completion

## WebSocket Communication Protocol

### Connection Management

- **URL**: `wss://api.vultisig.com/router/ws/{sessionId}`
- **Authentication**: Session ID serves as authentication
- **Timeout**: 10 minutes of inactivity closes connection
- **Reconnection**: Automatic retry with exponential backoff

### Message Format

```json
{
  "type": "keygen-dkls" | "keygen-schnorr" | "status" | "error",
  "from": "browser-1234",
  "to": ["Server-5678"],
  "sessionId": "abc123def456",
  "payload": "encrypted_mpc_data_here",
  "timestamp": 1640995200000
}
```

### Message Types

- `keygen-dkls`: DKLS protocol messages
- `keygen-schnorr`: Schnorr protocol messages
- `status`: Status updates and heartbeats
- `error`: Error notifications
- `complete`: Keygen completion signals

## Error Handling and Recovery

### Common Errors

1. **Peer Disconnection**: If VultiServer disconnects, retry connection
2. **Protocol Timeout**: Individual rounds have 30-second timeouts
3. **Invalid Messages**: Malformed or corrupted MPC messages
4. **Cryptographic Failures**: Invalid keys or failed validations

### Recovery Strategies

1. **Automatic Retry**: Most operations retry 3 times with backoff
2. **Session Reset**: If keygen fails, start new session with fresh parameters
3. **Partial Recovery**: ECDSA success + EdDSA failure still creates functional vault
4. **Graceful Degradation**: Vault works with ECDSA-only if Schnorr fails

### Retry Logic

```typescript
const retry = async (operation, maxAttempts = 3) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      await sleep(1000 * Math.pow(2, attempt)); // Exponential backoff
    }
  }
};
```

## Performance Characteristics

### Timing Expectations

- **Prepare Vault**: 1-3 seconds
- **ECDSA Keygen**: 5-15 seconds (most computationally intensive)
- **EdDSA Keygen**: 3-8 seconds
- **Total Duration**: 10-30 seconds typically

### Bandwidth Usage

- **Setup Phase**: ~2KB of parameter exchange
- **ECDSA Round**: ~5-10KB per round (3 rounds)
- **EdDSA Round**: ~3-7KB per round (3 rounds)
- **Total Bandwidth**: ~40-80KB per keygen session

### Resource Requirements

- **CPU**: High during key generation rounds
- **Memory**: ~10-50MB for WASM modules
- **WebSocket**: Persistent connection required
- **Storage**: Key shares encrypted locally

## Security Considerations

### Cryptographic Security

- **No Single Point of Failure**: Keys split between user device and VultiServer
- **Threshold Security**: Requires both parties to sign transactions
- **Perfect Forward Secrecy**: Session keys destroyed after use
- **Encrypted Communication**: All MPC messages encrypted in transit

### Session Security

- **Session Isolation**: Each keygen uses unique session ID
- **Time Limits**: Sessions expire after 10 minutes
- **Party Authentication**: Each device has verifiable party ID
- **Replay Protection**: Messages include timestamps and nonces

### Key Storage

- **Local Encryption**: Key shares encrypted with user password
- **Server Encryption**: VultiServer stores encrypted key shares
- **No Plaintext Storage**: Private keys never exist in plaintext
- **Secure Deletion**: Temporary keys wiped from memory

## Integration Notes

### SDK Implementation

The VultisigSDK abstracts this complexity behind `createFastVault()`:

```typescript
const result = await sdk.createFastVault({ name, email, password });
// Internally runs the complete 4-step keygen process
```

### Progress Tracking

UIs can track keygen progress using the step indicators:

- `prepareVault` → "Preparing vault..." (50%)
- `ecdsa` → "Generating ECDSA keys..." (70%)
- `eddsa` → "Generating EdDSA keys..." (90%)
- Complete → "Vault ready!" (100%)

### Chain Compatibility

- **ECDSA Keys**: Bitcoin, Ethereum, Litecoin, Thorchain, most Cosmos chains
- **EdDSA Keys**: Solana, some specialized Cosmos chains
- **Fallback**: Vault functional with ECDSA-only if EdDSA fails

This completes the technical specification for the MPC keygen flow via message relay infrastructure.
