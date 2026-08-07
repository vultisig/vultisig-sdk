---
'@vultisig/sdk': minor
---

Reject duplicate, stale, incompatible, and other-device vault shares before local import persistence, with an explicit compatible-share replacement option. Import persistence is revision-checked through the same optimistic-concurrency `vault.save()` every other vault mutation uses and committed with atomic compare-and-set across built-in storage backends, so a record that changes underneath an import is rejected instead of silently overwritten. Custom storage adapters must expose `compareAndSet` for vault imports. A locally unreadable existing record (corrupted, or an encrypted record whose password rotated) no longer permanently blocks re-importing your own valid backup with an explicit `conflictResolution: 'replace'`.

Existing callers of `importVault`/`importVaultWithResult` that relied on re-importing the same vault silently succeeding must now pass `{ conflictResolution: 'replace' }` explicitly - hence `minor`, not `patch`.
