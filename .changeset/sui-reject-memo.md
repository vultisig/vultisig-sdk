---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Reject a memo on Sui keysigns instead of silently dropping it. Sui has no native memo field (a transaction is a Programmable Transaction Block), so the Sui signing-input resolver now throws when `keysignPayload.memo` is set, surfacing the unsupported request to callers.
