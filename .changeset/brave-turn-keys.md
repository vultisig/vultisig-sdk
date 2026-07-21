---
'@vultisig/cli': minor
---

Send a fresh idempotency key for each agent message attempt, reuse it for the attempt's auth retry, and expose keyed-turn duplicates as a typed error with exit code 14.
