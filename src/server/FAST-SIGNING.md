# Fast Signing with VultiServer — Exact Flow & Endpoints

A tight, implementation-ready sequence for **server-assisted signing** with an existing Fast Vault.

---

## Preconditions

* You already have a Fast Vault and its **ECDSA public key** (`public_key_ecdsa`).
* You know the **vault password** used to encrypt the server share.
* You can derive or already have the **hex messages** to sign and a **derive path**.
* You can generate a **UUID v4 session ID** and a **browser party id** (free-form string). ([GitHub][1])

---

## Endpoint Base URLs

* **API Server (VultiServer)**: `https://api.vultisig.com`
* **Relay Server**: `https://api.vultisig.com/router`
  Session and message APIs live under `/router/*`. ([GitHub][2])

---

## One-Page Flow

### 1) Create a relay session and register your browser party

**POST** `/router/{sessionId}`
Body:

```json
["browser-1355"]
```

Expect `200 OK`. The relay treats IDs as opaque strings. ([GitHub][1])
*Note: You can GET `/router/{sessionId}` to list participants, but it may return `[]` (empty array) - participants don't always persist between calls.*

**(Optional) Mark started**
**POST** `/router/start/{sessionId}` → `200 OK`. ([GitHub][1])
*Note: May return 500 error if session doesn't exist first.*

---

### 2) Kick off keysign on VultiServer

**POST** `/vault/sign`
Body:

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

* Returns `200 OK` (no signature in this HTTP response). The server now participates in the MPC exchange via the **relay** using this `session`. ([GitHub][2])

---

### 3) Run the MPC message loop over the relay

Your WASM/SDK emits outbound messages and consumes inbound messages. Use the relay like this:

**Upload outbound message**
**POST** `/router/message/{sessionId}`

```json
{
  "session_id": "<session-uuid-v4>",
  "from": "browser-1355",
  "to": ["Server-1172"],
  "body": "<base64-of-encrypted-packet>",
  "hash": "<sha256(body)>",
  "sequence_no": 0
}
```

**Poll inbound messages (long-poll or short interval)**
**GET** `/router/message/{sessionId}/{participantId}`
Returns an array of pending messages for `participantId` (your browser id).
*Note: Server actually returns `[]` (empty array) when no messages, not `{}` object.*

**Acknowledge (delete) each processed message**
**DELETE** `/router/message/{sessionId}/{participantId}/{hash}`

Notes:

* Use **SHA-256 of the encrypted `body`** as the `hash`.
* For very large blobs, you may store/retrieve by hash via:
  **POST** `/router/payload/{hash}` and **GET** `/router/payload/{hash}`. ([GitHub][1])

Keep looping until your SDK reports **signature(s) ready**.

---

### 4) Mark completion and clean up

**POST** `/router/complete/{sessionId}/keysign` → optional, signals keysign done.
*Note: This endpoint returns 404 - may not be implemented yet.*
Then **DELETE** `/router/{sessionId}` to drop the session (or let expiry handle it). ([GitHub][1])

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

## Minimal Pseudocode (browser)

```ts
const sessionId = uuidv4()
const browserId = `browser-${Math.floor(1000 + Math.random()*9000)}`

// 1) Relay session
await fetch(`${relay}/${sessionId}`, { method: 'POST', body: JSON.stringify([browserId]) })
await fetch(`${relay}/start/${sessionId}`, { method: 'POST' })

// 2) Kick off keysign (server starts talking on relay)
await fetch(`${api}/vault/sign`, {
  method: 'POST',
  headers: {'content-type': 'application/json'},
  body: JSON.stringify({
    public_key,
    messages,               // array of hex strings
    session: sessionId,
    hex_encryption_key,     // 32-byte hex
    derive_path,            // e.g. m/44'/60'/0'/0/0
    is_ecdsa: true,
    vault_password
  })
})

// 3) MPC loop
while (!sdk.isDone()) {
  // outbound
  for (const pkt of sdk.outbound()) {
    const body = base64(pkt.bytes)
    const hash = sha256(body)
    await fetch(`${relay}/message/${sessionId}`, {
      method: 'POST', body: JSON.stringify({ session_id: sessionId, from: browserId, to: ["Server-1172"], body, hash, sequence_no: pkt.seq })
    })
  }

  // inbound
  const res = await fetch(`${relay}/message/${sessionId}/${browserId}`)
  const msgs = await res.json()
  for (const m of msgs) {
    sdk.consume(base64decode(m.body))
    await fetch(`${relay}/message/${sessionId}/${browserId}/${m.hash}`, { method: 'DELETE' })
  }
}

const signatures = sdk.result()

// 4) Complete + cleanup
await fetch(`${relay}/complete/${sessionId}/keysign`, { method: 'POST' })
await fetch(`${relay}/${sessionId}`, { method: 'DELETE' })
```

---

## Notes

* **No setup-message** is required for keysign; just the message loop.
* The **signature(s) come from your local MPC engine** when the loop completes. The `/vault/sign` HTTP call does not return the signature. ([GitHub][1])

---

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

1. **Message polling returns arrays**: `GET /message/{sessionId}/{participantId}` returns `[]` not `{}`
2. **Session participants don't persist**: `GET /{sessionId}` always returns `[]`
3. **Start endpoint requires session**: `POST /start/{sessionId}` returns 500 if session doesn't exist
4. **Completion endpoints missing**: `/complete/{sessionId}/keysign` endpoints return 404
5. **Payload endpoints missing**: `/payload/{hash}` endpoints return 404

### 🔧 Test Vault Used

- **Name**: TestFastVault
- **ECDSA Public Key**: `03ac0f333fc5d22f929e013be80988f57a56837db64d968c126ca4c943984744fd`
- **Signers**: `['Server-94060', 'iPhone-5C9']`
- **Password**: `Password123!`

---

**Sources**: Official VultiServer README for `/vault/sign` schema and vault endpoints; Relay README for session/message APIs, completion markers, payloads, and expiries. ([GitHub][2])

[1]: https://github.com/vultisig/vultisig-relay "GitHub - vultisig/vultisig-relay: vultisig-relay is a service that will be used to route TSS communications, for both keygen and keysign"
[2]: https://github.com/vultisig/VultiServer "GitHub - vultisig/vultiserver"