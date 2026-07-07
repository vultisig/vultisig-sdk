---
"@vultisig/cli": patch
---

fix(agent): sign purely from the `tool-output-available` channel and remove the `tx_ready` signing path (#927 Phase 2). The client-enriched tool-output candidate (flat builders and `execute_*` prep) is now the sole signing source, matching what the production backend emits — it writes the signable payload on tool-output and emits `data-tx_ready` only as a hollow `{typed_confirm}` marker the CLI never consumed. Removes the Phase-1 dual-read + parity cross-check machinery, the tx_ready capture/selection, and the recovered-tx_ready replay. Fail-closed postures are preserved (a structurally-unsignable candidate is never buffered), and a disconnect that ran a signable tool now warns to re-run rather than signing. Patch: no CLI API change and the same real transactions still sign — this aligns the internal signing source with production.
