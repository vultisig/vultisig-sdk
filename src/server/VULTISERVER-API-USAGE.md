Here's a **corrected, tighter** guide aligned to the two READMEs.

# VultiServer + Relay API Usage Guide (Corrected)

This documents the fast 2-of-2 "Fast Vault" flow that uses:

* **VultiServer (API Server)** on `https://api.vultisig.com` for `/vault/*` endpoints.
* **Relay Server** on `https://api.vultisig.com/router` for session and MPC message coordination. ([GitHub][1])

---

## Overview

Two services cooperate:

1. **VultiServer**: creates vaults, signs, reshares, migrates; exposes `/vault/*`. ([GitHub][1])
2. **Relay**: stateless message bus; exposes session, start/complete, message, setup-message, payload, ping. ([GitHub][2])

---

## Prerequisites

Generate:

* **Session ID**: UUID v4
* **Party IDs**: free-form identifiers (string). Recommended convention: `browser-####` for the client, `Server-####` for VultiServer.
* **Hex Encryption Key**: 32-byte hex
* **Hex Chain Code**: 32-byte hex

> Note: the "capital S is required" is **not** a server constraint; it's just a convention. The relay treats participant IDs as opaque strings. ([GitHub][2])

Example generators (unchanged):

```js
const generateLocalPartyId = () => `browser-${Math.floor(1000 + Math.random()*9000)}`
const generateServerPartyId = () => `Server-${Math.floor(1000 + Math.random()*9000)}`
const generateSessionId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0, v = c==='x'? r : (r&0x3|0x8)
    return v.toString(16)
  })
```

---

## Step-by-Step Flow

### 1) Create Vault (VultiServer)

**POST** `https://api.vultisig.com/vault/create`

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

* `lib_type`: `0` = GG20, `1` = DKLS. DKLS is the modern path and used broadly in Vultisig. ([GitHub][1])

**Response**: `200 OK`. ([GitHub][1])

---

### 2) Create Relay Session and Wait for Server

**2.1 Create session**

**POST** `https://api.vultisig.com/router/{sessionId}`
Body = JSON array of current participants (start with the browser):

```json
["browser-1355"]
```

**2.2 Poll for participants**

**GET** `https://api.vultisig.com/router/{sessionId}` → returns array of participant IDs, e.g.

```json
["browser-1355", "Server-1172"]
```

*Note: Server may return `[]` (empty array) - participants don't always persist between calls.*

Poll until the server party appears. **Sessions auto-expire after \~5 minutes** on the relay, so keep polling within that window. ([GitHub][2])

> Relay Session Endpoints (reference):
>
> * `POST /:sessionID` create
> * `GET /:sessionID` list participants
> * `DELETE /:sessionID` delete session. ([GitHub][2])

---

### 3) Mark Session Started (Relay)

**POST** `https://api.vultisig.com/router/start/{sessionId}`
(no body)

*Note: May return 500 error if session doesn't exist first.*

You can also **GET** `/start/{sessionId}` to read start status. Completion markers exist too; see Keysign complete below. ([GitHub][2])

---

### 4) MPC Key Generation via Relay

#### 4.1 Post one-time setup message

The relay exposes a single **setup-message** slot per `sessionId`.

* **POST** `https://api.vultisig.com/router/setup-message/{sessionId}`
  Body: binary (your WASM/SDK-emitted setup data)

* **GET** `https://api.vultisig.com/router/setup-message/{sessionId}`
  Returns whatever was posted. Typically the browser posts and VultiServer fetches. ([GitHub][2])

> Your document previously claimed the GET returns a message "uploaded by Server"; invert that: the GET returns **the posted setup message**, whichever side posted it.

#### 4.2 Message exchange loop

* **POST** `https://api.vultisig.com/router/message/{sessionId}`

Suggested JSON (fields are opaque to the relay, but this schema works well):

```json
{
  "session_id": "938124b5-7ddd-4bc7-9257-ec224962e7cb",
  "from": "browser-1355",
  "to": ["Server-1172"],
  "body": "base64-encoded-encrypted-mpc-message",
  "hash": "sha256-of-body",
  "sequence_no": 0
}
```

* **GET** `https://api.vultisig.com/router/message/{sessionId}/{participantId}` → returns array of pending messages for `participantId` (returns `[]` empty array when no messages, not `{}` object).
* **DELETE** `https://api.vultisig.com/router/message/{sessionId}/{participantId}/{hash}` → acknowledge/remove.

Notes:

* The relay verifies payloads by **SHA-256** hash and deduplicates; use the hash of the encrypted `body` as your `hash`. There is **no documented `message_id` header** on DELETE. ([GitHub][2])
* Optional **payload** store: `POST /payload/{hash}`, `GET /payload/{hash}` if you want out-of-band large blob transfer. ([GitHub][2])

#### 4.3 What you should expect from keygen results

* **ECDSA public key**: uncompressed **65-byte** hex (`0x04 || X32 || Y32`).
* **EdDSA public key** (Ed25519): 32 bytes.

Your original said "ECDSA 64 bytes starting with 04", which is inconsistent; uncompressed points are 65 bytes including the `0x04` prefix.

> The relay doesn't impose ECDSA/EdDSA specifics; it just routes bytes. VultiServer's vault response shows both public keys once created. ([GitHub][1])

---

### 5) Email Verification & Vault Retrieval (VultiServer)

**Verify code**

**GET** `https://api.vultisig.com/vault/verify/{public_key_ecdsa}/{code}`
`200 OK` means valid; any other status = invalid. ([GitHub][1])

**Resend vault share + code (rate-limited)**

**POST** `https://api.vultisig.com/vault/resend`

```json
{
  "public_key_ecdsa": "04....",
  "password": "Password123!",
  "email": "user@example.com"
}
```

Constraint: **once every \~3 minutes**. Your previous `/vault/resend-verification/{vaultId}` path is incorrect. ([GitHub][1])

**Get vault**

**GET** `https://api.vultisig.com/vault/get/{public_key_ecdsa}`
Header: `x-password: <plaintext password>`  ← **not base64**.
Response shape:

```json
{
  "name": "vault name",
  "public_key_ecdsa": "04..",
  "public_key_eddsa": "..",
  "hex_chain_code": "..",
  "local_party_id": "Server-1172"
}
```

Your previous example included `signers` and `keyshares`; those fields are **not** documented on this endpoint. ([GitHub][1])

---

### 6) Server-Assisted Signing (Keysign)

**POST** `https://api.vultisig.com/vault/sign`

```json
{
  "public_key": "04a1b2c3...",
  "messages": ["abc123...", "def456..."],
  "session": "938124b5-7ddd-4bc7-9257-ec224962e7cb",
  "hex_encryption_key": "a1b2c3...",
  "derive_path": "m/44'/60'/0'/0/0",
  "is_ecdsa": true,
  "vault_password": "Password123!"
}
```

* Field name is **`session`** (JSON example) rather than `session_id`.
* After initiating, run the **same relay message loop** as keygen.
* You **may** mark completion on relay:

  * `POST /complete/{sessionId}` for keygen complete
  * `POST /complete/{sessionId}/keysign` for keysign complete; and corresponding `GET` to read status. ([GitHub][2])

---

## Related (useful) VultiServer endpoints

* **Reshare**: `POST /vault/reshare` (old\_parties, reshare prefix)
* **Migrate GG20→DKLS**: `POST /vault/migrate`
  See README for exact payloads. ([GitHub][1])

---

## Health Checks

* **Relay**: `GET https://api.vultisig.com/router/ping`
* **API Server**: `GET /ping` (returns text: `Vultisigner is running`)
  Both are visible in the respective READMEs; Cloudflare routes the production base. ([GitHub][2])

---

## Timeouts, Expiry, Retries

* **Relay expiries**: sessions \~**5 min**, user data \~**1 hour**. Build your polling/backoff within that envelope. ([GitHub][2])
* **Client retry**: your exponential backoff plan is fine; keep **4xx non-retriable**, **5xx retriable**.

---

## Library Types

* `0` = GG20
* `1` = DKLS (current standard in Vultisig; supports ECDSA and EdDSA) ([GitHub][1])

---

## Quick SDK Sketch

```ts
// Create fast vault → verify → fetch vault
const { vaultId } = await sdk.createFastVault({
  name: "TestVault",
  email: "user@example.com",
  password: "Password123!"
})

await sdk.verifyVaultEmail(vaultId, "1234")

const vault = await sdk.getVault(vaultId, "Password123!")
```

---

## Real Server Behavior (Tested 2025-01-13)

Based on comprehensive testing with real VultiServer and MessageRelay endpoints:

### ✅ Working Endpoints

**VultiServer (api.vultisig.com/vault):**
- `POST /sign` → **200 OK** (no signature returned, as expected)
- `GET /get/{public_key_ecdsa}` → **200 OK** (returns vault object)

**MessageRelay (api.vultisig.com/router):**
- `POST /{sessionId}` with `[participantId]` → **200 OK**
- `GET /{sessionId}` → **200 OK** (returns `[]` empty array - participants don't persist)
- `DELETE /{sessionId}` → **200 OK**
- `POST /start/{sessionId}` → **200 OK** (when session exists) or **500** (when session missing)
- `GET /start/{sessionId}` → **200 OK**
- `POST /complete/{sessionId}` → **200 OK**
- `GET /complete/{sessionId}` → **200 OK**
- `POST /message/{sessionId}` → **200 OK** (accepts message uploads)
- `GET /message/{sessionId}/{participantId}` → **200 OK** (returns `[]` array, not `{}` object)
- `DELETE /message/{sessionId}/{participantId}/{hash}` → **200 OK**
- `GET /ping` → **200 OK** ("Voltix Router is running")

### ❌ Non-Working Endpoints

**MessageRelay:**
- `POST /complete/{sessionId}/keysign` → **404** (not implemented)
- `GET /complete/{sessionId}/keysign` → **404** (not implemented)
- `POST /payload/{hash}` → **404** (not implemented)
- `GET /payload/{hash}` → **404** (not implemented)

### 📋 Key Differences from Documentation

1. **Session participants don't persist**: `GET /{sessionId}` always returns `[]`
2. **Start endpoint requires session**: `POST /start/{sessionId}` returns 500 if session doesn't exist first
3. **Message polling returns arrays**: `GET /message/{sessionId}/{participantId}` returns `[]` not `{}`
4. **Completion endpoints missing**: `/complete/{sessionId}/keysign` endpoints return 404

### 🔧 Test Vault Used

- **Name**: TestFastVault
- **ECDSA Public Key**: `03ac0f333fc5d22f929e013be80988f57a56837db64d968c126ca4c943984744fd`
- **Signers**: `['Server-94060', 'iPhone-5C9']`
- **Password**: `Password123!`

---


[1]: https://github.com/vultisig/vultiserver "GitHub - vultisig/vultiserver"
[2]: https://github.com/vultisig/vultisig-relay "GitHub - vultisig/vultisig-relay: vultisig-relay is a service that will be used to route TSS communications, for both keygen and keysign"