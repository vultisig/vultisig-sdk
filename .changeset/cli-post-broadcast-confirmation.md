---
'@vultisig/cli': patch
---

Agent: poll for final on-chain confirmation after broadcasting a signed tx
(audit F1). A `pending` `tx_status` only means "broadcast accepted" — the tx can
still revert, expire, or be dropped. After broadcast the session now polls
`vault.getTxStatus` until the tx reaches a final state and emits `confirmed` /
`failed`, or `timeout` when the bounded poll budget (~120s) is exhausted. The
`ask` result records the latest per-tx `status` (deduped by hash), and the pipe
`tx_status` event gains a `timeout` status. Best-effort and non-fatal: when the
chain can't be resolved or the vault can't poll status, the existing `pending`
status stands. The blocking confirmation wait is scoped to the top of the
message loop (depth 0 — the single-tx ask/pipe case); inside a multi-turn tool
loop a leg keeps its honest `pending` instead of stacking the poll budget per
tx. The shared `pending | confirmed | failed | timeout` union is now threaded
through the ask result, pipe event, and UI callback without unchecked casts.
