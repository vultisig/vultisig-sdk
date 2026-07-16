---
'@vultisig/cli': patch
---

Report failed or declined agent signing, non-success turn outcomes, stale sessions, invalid command input, and permanent raw-broadcast validation errors with truthful non-success envelopes and typed exit codes.

Exit codes change for previously-mis-reported paths, so callers branching on `$?` should re-check: a declined/failed agent sign now exits non-zero (`CONFIRMATION_REQUIRED`/12 for a decline) instead of 0; a failure that follows an on-chain broadcast exits `BROADCAST_COMMITTED`/13 (never a retryable code); `send` to a malformed address now exits `INVALID_ADDRESS`/4 instead of `USAGE_ERROR`/1, matching the documented table and `address-book`.
