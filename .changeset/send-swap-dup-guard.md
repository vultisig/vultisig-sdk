---
'@vultisig/cli': patch
---

Wire the broadcast-journal double-spend guard into the direct `send` and `swap`
commands. Previously only the `agent ask` path consulted the persistent journal,
so a retried `send`/`swap` re-broadcast an identical intent (audit P5-1, HIGH —
double-spend). Both paths now share ONE journal: an identical send/swap within
the dedupe window is refused (exit code 9) instead of broadcasting a second time,
and `send`/`swap` gain a `--force` flag to override the guard.
