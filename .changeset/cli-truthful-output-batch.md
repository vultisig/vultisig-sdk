---
'@vultisig/cli': patch
---

Make CLI machine output tell the truth about what happened:

- Emit a result envelope from every successful mutation in `-o json`
  (switch/rename/currency/address-book/import/export/add-mldsa previously exited 0
  with no output at all).
- Emit exactly one JSON envelope from a failed `verify` — it previously wrote two
  documents, so `JSON.parse` on the output failed — and list vaults pending
  verification in `vaults`, which were otherwise only named in the create-time output.
- Validate the chain argument for `tokens` and `swap-quote`, which previously reported
  `success: true` with an empty list / a raw TypeError for an unknown chain. Both now
  throw a typed `INVALID_CHAIN` (exit 4).
- Add `NO_ACTIVE_VAULT` (15) and `CORRUPT_STATE` (16) exit codes with recovery hints,
  replacing a generic `UNKNOWN_ERROR`/7 for both states.
- Report `fee` and `total` from `send --dry-run` in JSON — the human preview already
  printed the fee, and `total` is the number the insufficient-balance warning is
  derived from.

Note: a failed `verify` now exits 4 (wrong/expired code) or 5 (unknown pending vault)
instead of 1. This is a deliberate change on a published surface — see the PR body.
