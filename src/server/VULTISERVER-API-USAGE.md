# VultiServer API Usage Guide

This document describes the complete fast vault creation flow used by VultisigSDK to interact with VultiServer infrastructure.

## Overview

Fast Vault creation involves two servers working together:
1. **FastVault Server** (`https://api.vultisig.com/vault`) - Handles vault storage and management
2. **MessageRelay Server** (`https://api.vultisig.com/router`) - Handles MPC session coordination

## Prerequisites

Before starting the fast vault creation flow, generate the following:

- **Session ID**: Valid UUID v4 format (e.g., `938124b5-7ddd-4bc7-9257-ec224962e7cb`)
- **Browser Party ID**: Format `browser-{4-digit-number}` (e.g., `browser-1355`)
- **Server Party ID**: Format `Server-{4-digit-number}` (e.g., `Server-1172`)
- **Hex Encryption Key**: 32 bytes, hex encoded (64 hex characters)
- **Hex Chain Code**: 32 bytes, hex encoded (64 hex characters)

### Party ID Generation

```javascript
// Browser party ID for local device
const generateLocalPartyId = () => {
  const num = Math.floor(1000 + Math.random() * 9000)
  return `browser-${num}`
}

// Server party ID sent to VultiServer
const generateServerPartyId = () => {
  const num = Math.floor(1000 + Math.random() * 9000)
  return `Server-${num}` // Capital 'S' is required
}

// UUID v4 session ID
const generateSessionId = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}
```

## Step-by-Step Flow

### Step 1: Register Vault with FastVault Server

**Endpoint**: `POST https://api.vultisig.com/vault/create`

**Purpose**: Registers the vault with VultiServer and initiates server participation

**Request Body**:
```json
{
  "name": "TestVault",
  "session_id": "938124b5-7ddd-4bc7-9257-ec224962e7cb",
  "hex_encryption_key": "9e9d1e4eee6bc304d059985ace844aad2934e56b2be89e8cdaf81da4b7c0ec79",
  "hex_chain_code": "05f345013d20b227415e43bcce3a9db09ca395f3e91e0b56270dbe3387ce453f",
  "local_party_id": "Server-1172",
  "encryption_password": "Password123!",
  "email": "user@example.com",
  "lib_type": 1
}
```

**Key Requirements**:
- `session_id`: Must be valid UUID v4 format
- `local_party_id`: Must be the server party ID (VultiServer uses this to join relay)
- `lib_type`: 1 for DKLS (recommended for dual ECDSA + EdDSA support)

**Response**: `200 OK`

### Step 2: Browser Joins Relay and Waits for Server

**2.1 Register Browser with Relay**

**Endpoint**: `POST https://api.vultisig.com/router/{sessionId}`

**Request Body**:
```json
["browser-1355"]
```

**2.2 Poll for VultiServer**

**Endpoint**: `GET https://api.vultisig.com/router/{sessionId}`

- Poll every 2 seconds until both parties appear
- Timeout after 30 seconds if server doesn't join

**Expected Response** (when ready):
```json
["browser-1355", "Server-1172"]
```

VultiServer automatically joins the relay using the server party ID from Step 1.

### Step 3: Start MPC Session

**Endpoint**: `POST https://api.vultisig.com/router/start/{sessionId}`

**Request Body**:
```json
["browser-1355", "Server-1172"]
```

**Response**: `200 OK`

### Step 4: MPC Key Generation

The MPC protocol runs in two phases with specific message coordination:

#### Phase 1: DKLS (ECDSA) Key Generation

**4.1.1 Upload DKLS Setup Message**

**Endpoint**: `POST https://api.vultisig.com/router/setup-message/{sessionId}`

**Request Body**: Binary DKLS setup message (varies in size, typically ~200-400 bytes)

**Purpose**: Browser uploads its DKLS protocol setup message for VultiServer to download

**4.1.2 VultiServer Downloads Setup Message**

**Endpoint**: `GET https://api.vultisig.com/router/setup-message/{sessionId}`

**Response**: Binary DKLS setup message uploaded by Server

**Purpose**: VultiServer retrieves Server's setup message to coordinate DKLS protocol

**4.1.3 DKLS Message Exchange Loop**

Both parties (browser and VultiServer) exchange MPC messages via relay:

**Upload Message**: `POST https://api.vultisig.com/router/message/{sessionId}`
```json
{
  "from": "browser-1355",
  "to": "Server-1172", 
  "message": "base64-encoded-mpc-message",
  "message_hash": "sha256-hash-of-message"
}
```

**Poll for Messages**: `GET https://api.vultisig.com/router/message/{sessionId}/{localPartyId}`

Returns array of pending messages:
```json
[
  {
    "from": "Server-1172",
    "to": "browser-1355",
    "message": "base64-encoded-mpc-message",
    "message_hash": "2d6df73e3a9ece454492200ac8ba2bea"
  }
]
```

**Acknowledge Message**: `DELETE https://api.vultisig.com/router/message/{sessionId}/{localPartyId}/{messageHash}`

**DKLS Protocol Execution**:
- Multi-round MPC protocol runs internally within WASM library
- Browser and VultiServer exchange encrypted messages via relay
- Protocol completes when WASM reports `keygen complete`

**Observable Events During DKLS**:
- `startKeygen attempt: 0` (initial attempt)
- `uploaded setup message successfully`
- `outbound message: [MessageObject]` (for each message sent)
- `got message from: Server-1172,to: browser-1355,key: [messageHash]` (for each message received)
- `keygen complete` (protocol finished)
- `stop processOutbound` (cleanup)

**DKLS Result**: 
- ECDSA public key (64 bytes, uncompressed format starting with '04')
- Encrypted ECDSA keyshare stored by VultiServer
- DKLS setup message for EdDSA coordination (261 bytes)

#### Phase 2: Schnorr (EdDSA) Key Generation

**4.2.1 Extract DKLS Setup Message**

After DKLS completion, browser extracts setup message from DKLS instance:
```javascript
const dklsSetupMessage = dklsInstance.getSetupMessage()
// Returns Uint8Array of 261 bytes containing coordination data
```

**4.2.2 Upload Schnorr Setup Message**  

**Endpoint**: `POST https://api.vultisig.com/router/setup-message/{sessionId}`

**Request Body**: DKLS setup message (261 bytes) for Schnorr coordination

**Purpose**: Provides VultiServer with DKLS context needed for EdDSA keygen

**4.2.3 Schnorr Message Exchange Loop**

Same endpoints as DKLS but with Schnorr protocol messages:

**Upload/Poll/Delete**: Same pattern as DKLS using message relay endpoints

**Schnorr Protocol Execution**:
- Uses DKLS setup message for coordination with ECDSA keygen
- Multi-round EdDSA protocol runs internally within WASM library
- Requires valid 261-byte setup message or keygen fails with "setup message is empty"

**Observable Events During Schnorr**:
- `startKeygen attempt: 0` (initial attempt)
- `session id: [sessionId]` (session confirmation)
- `outbound message: [MessageObject]` (for each EdDSA message sent)
- `got message from: Server-1172,to: browser-1355,key: [messageHash]` (for each message received)
- `keygen complete` (EdDSA protocol finished)
- `stop processOutbound` (cleanup)

**Schnorr Result**:
- EdDSA public key (32 bytes, compressed format)  
- Encrypted EdDSA keyshare stored by VultiServer

#### Message Flow Pattern

The MPC protocol follows this message exchange pattern:

```
Browser                    Relay Server                VultiServer
   |                           |                           |
   |-- POST setup-message ---> |                           |
   |                           | <-- GET setup-message ---|
   |                           |                           |
   |-- POST message (M1) ----> |                           |
   |                           | <-- GET message (M1) -----|
   |                           |                           |
   | <-- GET message (M1) ---- | <-- POST message (M1) ---|
   |-- DELETE message (M1) --> |                           |
   |                           |-- DELETE message (M1) -->|
   |                           |                           |
   [Multiple message exchanges until protocol complete]
   |                           |                           |
   | keygen complete           |           keygen complete |
```

**Notes**:
- Message count varies per protocol execution (typically 4-8 messages total)
- Each party polls for messages continuously until `keygen complete`
- WASM library handles the internal round logic and message generation

#### Retry Logic for Failed Keygens

**Maximum Attempts**: 3 attempts with exponential backoff

**Backoff Schedule**:
- Attempt 1: Immediate
- Attempt 2: Wait 1 second  
- Attempt 3: Wait 2 seconds

**Failure Conditions**:
- Empty or invalid setup message (< 200 bytes for DKLS, must be exactly 261 bytes for Schnorr)
- Network timeout during message exchange  
- VultiServer not responding to setup message
- WASM library throws keygen errors
- Message corruption or invalid signatures

**Recovery Process**:
1. Clear all pending messages from relay
2. Generate fresh setup message (for DKLS) or reuse DKLS setup (for Schnorr)  
3. Restart `startKeygen(attemptNumber)` with incremented attempt counter
4. If 3 attempts fail: Throw error (no silent fallback to ECDSA-only)

**Error Messages**:
- `"setup message is empty"` - Missing or zero-length setup message
- `"DKLS keygen failed"` - ECDSA protocol failed after 3 attempts  
- `"Schnorr keygen failed"` - EdDSA protocol failed after 3 attempts

### Step 5: Email Verification

**Endpoint**: `GET https://api.vultisig.com/vault/verify/{vaultId}/{code}`

**Parameters**:
- `vaultId`: ECDSA public key (vault identifier)
- `code`: 4-digit verification code from email

**Response**: `200 OK` if valid, `400 Bad Request` if invalid

**UI Requirements**:
```html
<input
  type="text"
  placeholder="Enter 4-digit verification code"
  maxLength="4"
  pattern="[0-9]{4}"
  style="text-align: center; letter-spacing: 0.2em"
  required
/>
```

**Resend Email**: `POST https://api.vultisig.com/vault/resend-verification/{vaultId}`

### Step 6: Retrieve Verified Vault

**Endpoint**: `GET https://api.vultisig.com/vault/get/{vaultId}`

**Headers**:
```
x-password: base64(encryption_password)
```

**Response**:
```json
{
  "name": "TestVault",
  "public_key_ecdsa": "04a1b2c3d4e5f6789...",
  "public_key_eddsa": "a1b2c3d4e5f6789...",
  "hex_chain_code": "1a2b3c4d5e6f789...",
  "signers": ["browser-1355", "Server-1172"],
  "local_party_id": "browser-1355",
  "keyshares": {...}
}
```

## Server-Assisted Signing

**Endpoint**: `POST https://api.vultisig.com/vault/sign`

**Request Body**:
```json
{
  "public_key": "04a1b2c3d4e5f6789...",
  "messages": ["abc123...", "def456..."],
  "session": "signing-session-uuid",
  "hex_encryption_key": "a1b2c3d4e5f6789...",
  "derive_path": "m/44'/60'/0'/0/0",
  "is_ecdsa": true,
  "vault_password": "Password123!"
}
```

**Response**: `200 OK` (signature delivered via MPC session)

## SDK Integration

```typescript
// Create fast vault
const result = await sdk.createFastVault({
  name: "TestVault",
  email: "user@example.com", 
  password: "Password123!"
})

// Verify email
await sdk.verifyVaultEmail(result.vaultId, "1234")

// Get complete vault
const vault = await sdk.getVault(result.vaultId, "Password123!")
```

## Error Handling

### Common HTTP Status Codes

- `200 OK` - Success
- `400 Bad Request` - Invalid parameters or malformed request
- `401 Unauthorized` - Invalid credentials
- `403 Forbidden` - Email not verified
- `404 Not Found` - Vault or session not found
- `409 Conflict` - Vault already exists
- `500 Internal Server Error` - Server error

### Session Management

- Sessions expire after 10 minutes of inactivity
- Session IDs must be valid UUIDs
- Party IDs must follow exact format requirements

### Retry Strategy

- **Network errors**: Exponential backoff (1s, 2s, 4s, 8s)
- **Server errors (5xx)**: Retry up to 3 times
- **Client errors (4xx)**: Do not retry
- **MPC failures**: Retry up to 3 times with setup message coordination

## Health Check

**Endpoint**: `GET https://api.vultisig.com/router/ping`

**Response**: `200 OK` with timestamp

## Security Notes

- All vault data is encrypted with AES-GCM using the user password
- ECDSA public key serves as the vault identifier
- Email verification prevents unauthorized vault access
- MPC ensures no single point of key control
- Cryptographically secure random number generation for all keys

## Library Types

- `0` = GG20 (legacy, wider compatibility)  
- `1` = DKLS (recommended, better performance and dual signature support)

DKLS (lib_type: 1) is recommended for new implementations as it provides both ECDSA and EdDSA signatures with better performance.