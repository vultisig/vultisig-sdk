---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Add `toPolicyEnvelope` / `policy.fromDecodedEnvelope` so consumers can feed `decodeFromToolResult()` output into the policy and invariant helpers without maintaining their own chain/amount adapter.
