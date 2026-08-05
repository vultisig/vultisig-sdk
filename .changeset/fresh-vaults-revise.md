---
'@vultisig/sdk': minor
---

Prevent stale vault instances from overwriting newer storage updates. `vault.save()` now rejects stale writes with
`VaultConflictError`; pass `{ conflictStrategy: 'merge-metadata' }` to retry a non-overlapping metadata edit.
