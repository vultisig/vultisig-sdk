---
'@vultisig/cli': patch
---

Fix CLI client-side tool dispatch. The CLI gated dispatch on a `clientExecuted` wire flag the backend no longer emits, so `sign_typed_data`, `vault_coin`, `vault_chain`, and `address_book` silently stopped dispatching and degraded to display-only progress. Dispatch now keys on the existing client-side-tool registry (mirroring the app's `toolUIRegistry`), restoring those flows.
