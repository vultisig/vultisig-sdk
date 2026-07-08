---
'@vultisig/cli': patch
---

Wire the broadcast-journal double-spend guard into the direct `send` and `swap`
commands. Previously only the `agent ask` path consulted the persistent journal,
so a retried `send`/`swap` re-broadcast an identical intent (audit P5-1, HIGH —
double-spend). Both paths now share ONE journal: an identical send/swap within
the dedupe window is refused (exit code 9) instead of broadcasting a second time,
and `send`/`swap` gain a `--force` flag to override the guard.

`--max` sends/swaps fingerprint a stable sentinel (not the drift-prone resolved
amount) so a `--max` retry can't slip past the guard when the fee/balance moves.
The journal is namespaced by the vault's ECDSA key (falling back to the vault id),
so a native/EVM `send` and an identical `agent ask` cross-dedupe against the one
journal; ERC-20-token cross-path and swap cross-path dedup are out of scope (a
missed dedup, never a double-spend).
