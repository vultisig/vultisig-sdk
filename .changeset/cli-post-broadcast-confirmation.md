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
status stands.
