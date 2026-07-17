---
'@vultisig/cli': patch
'@vultisig/sdk': patch
---

Batch of small CLI polish and truthfulness fixes:

- Write exported `.vult` files owner-only (0600) instead of with the default umask.
- Validate the chain argument for `tokens` and `swap-quote`, which previously reported
  `success: true` with an empty list / a raw TypeError for an unknown chain.
- Stop `rename` rejecting vault names the ecosystem itself creates (e.g. the `#` in
  "Vultisig Cluster #1"), which made rename a one-way door.
- Add `NO_ACTIVE_VAULT` (15) and `CORRUPT_STATE` (16) exit codes with recovery hints,
  replacing a generic `UNKNOWN_ERROR`/7 for both states.
- Emit exactly one JSON envelope from a failed `verify` (it previously wrote two
  documents, breaking `JSON.parse`), and list vaults pending verification in `vaults`.
- Emit a result envelope from every successful mutation in `-o json`
  (switch/rename/currency/address-book/import/export previously exited 0 with no output).
- Generate shell completion from the Commander and SDK chain registries instead of a
  stale hardcoded list.
- Silence the `bigint: Failed to load bindings` warning printed to stderr on every
  invocation.
- Report `fee` and `total` from `send --dry-run` in JSON.
