---
'@vultisig/sdk': patch
---

Reject duplicate, stale, incompatible, and other-device vault shares before local import persistence, with an explicit compatible-share replacement option, atomic conditional writes across built-in storage backends, and rollback-safe retries. Custom storage adapters must expose `compareAndSet` for vault imports.
