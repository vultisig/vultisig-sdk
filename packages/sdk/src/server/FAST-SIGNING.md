# Fast Signing with VultiServer — Two-Step Flow (Extension-Compatible)

A tight, implementation-ready sequence for **server-assisted signing** with an existing Fast Vault that matches the extension's approach.

---

## Architecture Overview

Fast signing uses a **two-step approach** to coordinate between:

1. **FastVault Server** (`/vault/sign`) - Initiates server-side MPC participation
2. **MessageRelay Server** (`/router/*`) - Handles MPC message coordination

This approach **bypasses setup message exchange** since the FastVault server handles MPC coordination directly.

---

## Preconditions

- You already have a Fast Vault and its **ECDSA public key** (`public_key_ecdsa`).
- You know the **vault password** used to encrypt the server share.
- You can derive or already have the **hex messages** to sign and a **derive path**.
- You can generate a **UUID v4 session ID** and a **browser party id** (free-form string).

---

## Endpoint Base URLs

- **FastVault Server**: `https://api.vultisig.com/vault`
- **MessageRelay Server**: `https://api.vultisig.com/router`

---

## Two-Step Flow

### Step 1: Initiate Server-Side Signing

**POST** `https://api.vultisig.com/vault/sign`

```json
{
  "public_key": "04...ecdsa_uncompressed...",
  "messages": ["<hex-msg-1>", "<hex-msg-2>"],
  "session": "<session-uuid-v4>",
  "hex_encryption_key": "<32-byte-hex>",
  "derive_path": "m/44'/60'/0'/0/0",
  "is_ecdsa": true,
  "vault_password": "<password>"
}
```

**Expected Response**: `200 OK` (no signature returned)
**Purpose**: Tells the FastVault server to prepare for MPC signing on the specified session

**⚠️ Current Server Issue**: Returns `405 Method Not Allowed` (server configuration problem)

---

### Step 2: Set Up Relay Session

**POST** `https://api.vultisig.com/router/{sessionId}`

```json
["browser-1355"]
```

**Expected Response**: `200 OK`
**Purpose**: Register your browser as a participant in the MPC session

**Optional - Mark Session Started:**
**POST** `https://api.vultisig.com/router/start/{sessionId}` → `200 OK`

---

### Step 3: Wait for Server to Join

**GET** `https://api.vultisig.com/router/{sessionId}`

Poll until server participant appears (e.g., `["browser-1355", "Server-1172"]`)

**Note**: May return `[]` empty array - participants don't always persist between calls.

---

### Step 4: MPC Message Exchange (No Setup Message)

**Key Difference**: Fast signing **skips setup message exchange** because the FastVault server coordinates the MPC session directly.

{
"session_id": "<session-uuid-v4>",
"from": "browser-1355",
"to": ["Server-1172"],
"body": "<base64-of-encrypted-packet>",
"hash": "<sha256(body)>",
"sequence_no": 0
}

````

**Poll inbound messages:**
**GET** `/router/message/{sessionId}/{participantId}`

Returns an array of pending messages for `participantId` (your browser id).

**Acknowledge processed messages:**
**DELETE** `/router/message/{sessionId}/{participantId}/{hash}`

**Notes:**
- Use **SHA-256 of the encrypted `body`** as the `hash`
- Returns `[]` empty array when no messages (not `{}` object)
- Payload endpoints (`/payload/{hash}`) return 404 (not implemented)

Keep looping until your SDK reports **signature(s) ready**.

---

### Step 5: Completion and Cleanup

**Optional - Mark keysign complete:**
**POST** `/router/complete/{sessionId}/keysign`

**⚠️ Note**: This endpoint returns 404 (not implemented yet)

**Clean up session:**
**DELETE** `/router/{sessionId}` or let it expire (~5 minutes)

---

## Endpoints — Cheat Sheet

### Relay (stateless message bus)

* **Session**

  * `POST /router/{sessionId}` — create/register participants
  * `GET /router/{sessionId}` — list participants
  * `DELETE /router/{sessionId}` — delete session
* **Start/Complete**

  * `POST /router/start/{sessionId}`, `GET /router/start/{sessionId}`
  * `POST /router/complete/{sessionId}`, `GET /router/complete/{sessionId}`
  * `POST /router/complete/{sessionId}/keysign`, `GET /router/complete/{sessionId}/keysign`
* **Messages**

  * `POST /router/message/{sessionId}`
  * `GET /router/message/{sessionId}/{participantId}`
  * `DELETE /router/message/{sessionId}/{participantId}/{hash}`
* **Payloads (optional)**

  * `POST /router/payload/{hash}`, `GET /router/payload/{hash}`
* **Health**

  * `GET /router/ping`
    Expiry defaults: sessions \~5 minutes, user data \~1 hour. ([GitHub][1])

### VultiServer (API Server)

* **Kick off signing**: `POST /vault/sign` (body shown above)
* **(Related) Get vault**: `GET /vault/get/{public_key_ecdsa}` with `x-password: <password>` header if you need to fetch vault metadata. ([GitHub][2])

---

## Timing, Retries, and Expiry

* **Relay expiry**: sessions \~5 min, user data \~1 h. Keep your poll cadence tight, or refresh/create a new session if it expires. ([GitHub][1])
* **Polling**: 500–1500 ms interval is typical for snappy UX.
* **Retries**:

  * **Network/5xx**: exponential backoff (e.g., 0.5 s, 1 s, 2 s).
  * **4xx**: fix the request; do not retry.
  * **Stalled MPC**: clear pending messages, recreate session, re-POST `/vault/sign`.

---

## SDK Implementation (TypeScript)

```ts
// Two-step fast signing approach (matches extension)
const sessionId = uuidv4()
const browserId = `browser-${Math.floor(1000 + Math.random()*9000)}`
const hexEncryptionKey = generateHexEncryptionKey() // 32-byte hex

// STEP 1: Initiate server-side signing
await fetch('https://api.vultisig.com/vault/sign', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    public_key: vault.publicKeys.ecdsa,
    messages: messageHashes,        // array of hex strings
    session: sessionId,
    hex_encryption_key: hexEncryptionKey,
    derive_path: "m/44'/60'/0'/0/0", // or appropriate path
    is_ecdsa: true,
    vault_password: password
  })
})

// STEP 2: Set up relay session
await fetch(`https://api.vultisig.com/router/${sessionId}`, {
  method: 'POST',
  body: JSON.stringify([browserId])
})

// Optional: Mark session started
await fetch(`https://api.vultisig.com/router/start/${sessionId}`, { method: 'POST' })

// STEP 3: Wait for server to join
let peers = []
while (peers.length === 0) {
  const response = await fetch(`https://api.vultisig.com/router/${sessionId}`)
  const participants = await response.json()
  peers = participants.filter(p => p !== browserId)
  if (peers.length === 0) await sleep(2000) // Wait 2 seconds
}

// STEP 4: MPC message exchange (bypasses setup message)
const signature = await fastKeysign({
  keyShare: vault.keyShares.ecdsa,
  signatureAlgorithm: 'ecdsa',
  message: messageHashes[0],
  chainPath: derivePath,
  localPartyId: browserId,
  peers,
  serverUrl: 'https://api.vultisig.com/router',
  sessionId,
  hexEncryptionKey,
  isInitiatingDevice: true
})

// STEP 5: Cleanup
await fetch(`https://api.vultisig.com/router/${sessionId}`, { method: 'DELETE' })
````

---

## Key Architectural Differences

### ❌ **Old Approach (Problematic)**

1. Call `vault.sign('fast')` → immediately calls `keysign()`
2. `keysign()` tries to upload setup message → **404 error**
3. Fails before reaching FastVault server

### ✅ **New Approach (Extension-Compatible)**

1. Call FastVault server API first (`/vault/sign`)
2. Set up relay session and wait for server
3. Perform MPC keysign with **no setup message exchange**
4. Server coordinates MPC directly through relay

---

## Current Server Status

**✅ Working:**

- FastVault server exists and responds
- MessageRelay endpoints work correctly
- Two-step approach reaches correct endpoints

**⚠️ Known Issues:**

- FastVault `/vault/sign` returns `405 Method Not Allowed` (server configuration issue)
- Some MessageRelay endpoints return 404 (not implemented: `/complete/{sessionId}/keysign`, `/payload/{hash}`)

**🎯 Next Steps:**

- Fix FastVault server HTTP method configuration
- Complete MessageRelay endpoint implementations

**Sources**: Official VultiServer README for `/vault/sign` schema and vault endpoints; Relay README for session/message APIs, completion markers, payloads, and expiries.

[1]: https://github.com/vultisig/vultisig-relay "GitHub - vultisig/vultisig-relay: vultisig-relay is a service that will be used to route TSS communications, for both keygen and keysign"
[2]: https://github.com/vultisig/VultiServer "GitHub - vultisig/vultiserver"
