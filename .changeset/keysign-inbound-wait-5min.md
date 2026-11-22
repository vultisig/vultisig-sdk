---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Keysign now waits up to 5 minutes for inbound relay messages instead of 3, matching the relay's 5-minute session and message TTL. A co-signer that is slow to respond no longer makes the initiator give up on a session the relay still holds, which surfaced as `Exited inbound processing due to a timeout after 3 min`.
