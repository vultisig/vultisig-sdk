---
'@vultisig/cli': minor
---

Gate signing in `agent ask` mode behind explicit confirmation (security fix).

Previously `vsig agent ask` auto-signed and broadcast any transaction envelope the
backend returned, gated only by whether a password was present. Because the backend
routes read-only swap intents (e.g. "list swap routes from USDC to ETH") to the
fund-moving `execute_swap` tool, a query could broadcast a real on-chain swap.

`runPasswordGatedTool` now calls `ui.requestConfirmation` before any `sign_tx` /
`sign_typed_data` (the single chokepoint for both the tx_ready path and client-side
dispatch, covering both legs of a multi-leg swap). In ask mode this defaults to
**deny**: signing/broadcast now requires the new `agent ask --yes` flag. Without it,
the proposed transaction is reported (`CONFIRMATION_REQUIRED`) and nothing is signed.
Interactive (TUI) and pipe (`--via-agent`) modes already prompt/defer for confirmation.

Behavior change: unattended signing via `agent ask` must now pass `--yes`.
