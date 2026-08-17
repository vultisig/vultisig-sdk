---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Surface Cosmos account-sequence mismatches with direction-aware recovery: stale signed transactions now require rebuilding and a new signing ceremony, while future-sequence transactions may wait for their predecessor and retry. Preserve peer-broadcast hash verification and retry only the recoverable future-sequence case.
