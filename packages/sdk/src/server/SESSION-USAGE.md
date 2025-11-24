# Vultisig Relay Session Usage Guide

This document provides detailed instructions for clients to perform key generation (keygen) and key signing (keysign) operations using the Vultisig Relay server.

## Prerequisites

- Vultisig Relay server running and accessible
- Unique session ID for each TSS ceremony
- List of participant IDs for the ceremony
- TSS protocol implementation on client side

## Keygen Flow - Detailed Steps

### Step 1: Create Session

**Endpoint**: `POST /:sessionID`

**Purpose**: Initialize a new TSS session with participant list

**Request**:

```http
POST https://api.vultisig.com/router/my-keygen-session-123
Content-Type: application/json

["participant1", "participant2", "participant3"]
```

**Parameters**:

- `sessionID` (URL path): Unique identifier for the session
- Body: JSON array of participant IDs (strings)

**Response**:

- `201 Created`: Session created successfully
- `400 Bad Request`: Invalid session ID or participant list
- `500 Internal Server Error`: Server error

**Notes**:

- Session expires after 5 minutes of inactivity
- Each participant ID should be unique within the session
- Session ID should be shared with all participants

---

### Step 2: Verify Session (All Participants)

**Endpoint**: `GET /:sessionID`

**Purpose**: Confirm session exists and retrieve participant list

**Request**:

```http
GET https://api.vultisig.com/router/my-keygen-session-123
```

**Parameters**:

- `sessionID` (URL path): The session identifier

**Response**:

- `200 OK`: Returns participant array

```json
["participant1", "participant2", "participant3"]
```

- `404 Not Found`: Session doesn't exist or expired

**Notes**:

- All participants should verify the session before proceeding
- Check that expected participants are in the returned list

---

### Step 3: Post Setup Message (Optional)

**Endpoint**: `POST /setup-message/:sessionID`

**Purpose**: Share initial setup data for the keygen ceremony

**Request**:

```http
POST https://api.vultisig.com/router/setup-message/my-keygen-session-123
Content-Type: application/json
message_id: setup-001

{setup data payload}
```

**Parameters**:

- `sessionID` (URL path): The session identifier
- `message_id` (Header, optional): Message identifier for tracking
- Body: Setup data (string or JSON)

**Response**:

- `201 Created`: Setup message stored
- `400 Bad Request`: Invalid session ID or payload
- `500 Internal Server Error`: Server error

**Notes**:

- Optional step for sharing initial parameters
- Can be retrieved later using `GET /setup-message/:sessionID`

---

### Step 4: Start TSS Session

**Endpoint**: `POST /start/:sessionID`

**Purpose**: Signal that TSS keygen ceremony should begin

**Request**:

```http
POST https://api.vultisig.com/router/start/my-keygen-session-123
Content-Type: application/json

["participant1", "participant2", "participant3"]
```

**Parameters**:

- `sessionID` (URL path): The session identifier
- Body: JSON array of participant IDs who will participate

**Response**:

- `200 OK`: TSS session marked as started
- `400 Bad Request`: Invalid session ID or participant list
- `500 Internal Server Error`: Server error

**Notes**:

- Usually called by the session initiator
- All participants should be ready to start TSS protocol
- Participant list should match the original session participants

---

### Step 5: Check TSS Start Status (All Participants)

**Endpoint**: `GET /start/:sessionID`

**Purpose**: Verify that TSS session has been marked as started

**Request**:

```http
GET https://api.vultisig.com/router/start/my-keygen-session-123
```

**Parameters**:

- `sessionID` (URL path): The session identifier

**Response**:

- `200 OK`: Returns participant array, TSS is started
- `404 Not Found`: TSS not started yet

**Notes**:

- All participants should poll this endpoint until TSS is started
- Proceed to message exchange once this returns 200

---

### Step 6: TSS Message Exchange Loop

#### 6a. Send Messages

**Endpoint**: `POST /message/:sessionID`

**Purpose**: Send TSS protocol messages to other participants

**Request**:

```http
POST https://api.vultisig.com/router/message/my-keygen-session-123
Content-Type: application/json
message_id: msg-round-1-001

{
  "from": "participant1",
  "to": ["participant2", "participant3"],
  "body": "encrypted_tss_message_data",
  "hash": "sha256_hash_of_message",
  "sequence_no": 1
}
```

**Parameters**:

- `sessionID` (URL path): The session identifier
- `message_id` (Header, optional): Message identifier for tracking
- Body: Message object with fields:
  - `from` (string): Sender's participant ID
  - `to` (array): List of recipient participant IDs
  - `body` (string): Encrypted TSS message content
  - `hash` (string): SHA-256 hash of the message
  - `sequence_no` (number): Message sequence number

**Response**:

- `202 Accepted`: Message queued for recipients
- `400 Bad Request`: Invalid message format
- `500 Internal Server Error`: Server error

---

#### 6b. Receive Messages

**Endpoint**: `GET /message/:sessionID/:participantID`

**Purpose**: Retrieve messages addressed to a specific participant

**Request**:

```http
GET https://api.vultisig.com/router/message/my-keygen-session-123/participant1
message_id: msg-round-1
```

**Parameters**:

- `sessionID` (URL path): The session identifier
- `participantID` (URL path): Your participant ID (URL encoded if needed)
- `message_id` (Header, optional): Filter by message ID

**Response**:

- `200 OK`: Returns array of messages

```json
[
  {
    "from": "participant2",
    "to": ["participant1"],
    "body": "encrypted_tss_response",
    "hash": "response_hash",
    "sequence_no": 2
  }
]
```

- `200 OK` (empty): No messages available `[]`

**Notes**:

- Poll this endpoint regularly during TSS ceremony
- Messages expire after 1 hour
- Use URL encoding for participant IDs with special characters

---

#### 6c. Delete Processed Messages (Optional)

**Endpoint**: `DELETE /message/:sessionID/:participantID/:hash`

**Purpose**: Remove a specific message after processing

**Request**:

```http
DELETE https://api.vultisig.com/router/message/my-keygen-session-123/participant1/message_hash_123
message_id: msg-round-1
```

**Parameters**:

- `sessionID` (URL path): The session identifier
- `participantID` (URL path): Your participant ID
- `hash` (URL path): Hash of the message to delete
- `message_id` (Header, optional): Message ID filter

**Response**:

- `200 OK`: Message deleted
- `400 Bad Request`: Invalid parameters
- `500 Internal Server Error`: Server error

---

### Step 7: Handle Large Payloads (Optional)

For large TSS messages, use the payload system:

#### 7a. Store Payload

**Endpoint**: `POST /payload/:hash`

**Purpose**: Store large payload data with hash verification

**Request**:

```http
POST https://api.vultisig.com/router/payload/sha256_hash_of_payload
Content-Type: application/octet-stream

{large_payload_data}
```

**Parameters**:

- `hash` (URL path): SHA-256 hash of the payload
- Body: Raw payload data

**Response**:

- `200 OK`: Payload stored
- `400 Bad Request`: Hash mismatch or invalid data

#### 7b. Retrieve Payload

**Endpoint**: `GET /payload/:hash`

**Request**:

```http
GET https://api.vultisig.com/router/payload/sha256_hash_of_payload
```

**Response**:

- `200 OK`: Returns payload data
- `404 Not Found`: Payload not found

---

### Step 8: Mark Session Complete

**Endpoint**: `POST /complete/:sessionID`

**Purpose**: Mark the keygen ceremony as completed

**Request**:

```http
POST https://api.vultisig.com/router/complete/my-keygen-session-123
Content-Type: application/json

["participant1", "participant2", "participant3"]
```

**Parameters**:

- `sessionID` (URL path): The session identifier
- Body: JSON array of participants who completed the ceremony

**Response**:

- `200 OK`: Session marked as complete
- `400 Bad Request`: Invalid session ID or participant list

---

### Step 9: Verify Completion (All Participants)

**Endpoint**: `GET /complete/:sessionID`

**Purpose**: Check if the keygen ceremony is complete

**Request**:

```http
GET https://api.vultisig.com/router/complete/my-keygen-session-123
```

**Response**:

- `200 OK`: Returns participant array, ceremony is complete
- `404 Not Found`: Not completed yet

---

### Step 10: Cleanup Session

**Endpoint**: `DELETE /:sessionID`

**Purpose**: Remove session and all associated messages

**Request**:

```http
DELETE https://api.vultisig.com/router/my-keygen-session-123
```

**Response**:

- `200 OK`: Session deleted
- `500 Internal Server Error`: Deletion failed

**Notes**:

- Usually called by session initiator
- Removes all messages and session data
- Should be done after successful keygen completion

---

## Keysign Flow

For key signing operations, follow similar steps but use these additional endpoints:

### Mark Keysign Complete

**Endpoint**: `POST /complete/:sessionID/keysign`

**Request**:

```http
POST https://api.vultisig.com/router/complete/my-keysign-session-123/keysign
message_id: keysign-001

{signature_data}
```

### Check Keysign Status

**Endpoint**: `GET /complete/:sessionID/keysign`

**Request**:

```http
GET https://api.vultisig.com/router/complete/my-keysign-session-123/keysign
message_id: keysign-001
```

---

## Error Handling

### Common HTTP Status Codes

- `200 OK`: Request successful
- `201 Created`: Resource created successfully
- `202 Accepted`: Request accepted for processing
- `400 Bad Request`: Invalid request parameters or body
- `404 Not Found`: Resource not found or expired
- `408 Request Timeout`: Request cancelled or timed out
- `500 Internal Server Error`: Server-side error

### Retry Strategy

- For `408` errors: Retry the request
- For `500` errors: Wait and retry with exponential backoff
- For `404` errors during polling: Continue polling (resource may not exist yet)
- For `400` errors: Fix request parameters before retrying

---

## Security Considerations

1. **Hash Verification**: All payload messages are verified against SHA-256 hashes
2. **Message Deduplication**: Server prevents duplicate message storage
3. **Automatic Expiration**: Sessions expire after 5 minutes, messages after 1 hour
4. **Context Cancellation**: Server handles request cancellations properly
5. **Input Validation**: All inputs are validated for security

---

## Best Practices

1. **Session IDs**: Use cryptographically secure random session IDs
2. **Participant IDs**: Use consistent participant identifiers across all operations
3. **Message Ordering**: Use sequence numbers to maintain message order
4. **Error Handling**: Implement proper retry logic for network failures
5. **Cleanup**: Always clean up sessions after completion
6. **Polling**: Use reasonable polling intervals to avoid overwhelming the server
7. **URL Encoding**: Properly encode participant IDs in URLs
8. **Message IDs**: Use message IDs for better tracking and debugging

---

## Health Check

**Endpoint**: `GET /ping`

**Purpose**: Verify server is running

**Response**: `200 OK` with "Voltix Router is running"

Use this endpoint to verify connectivity before starting TSS operations.
