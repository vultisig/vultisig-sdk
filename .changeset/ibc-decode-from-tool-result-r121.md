---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Decode SDK-built Cosmos IBC transfer payloads through `decodeFromToolResult` so downstream safety surfaces can recover the recipient and denom from the canonical bytes oracle.
