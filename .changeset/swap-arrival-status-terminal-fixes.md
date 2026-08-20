---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Fix three unsafe terminal-state gaps in `getSwapArrivalStatus`: LI.FI `DONE/PARTIAL` (user received a different token than requested) is now reported as a distinct `partial` status instead of being flattened into `success`; malformed or unknown Midgard action statuses now throw `SwapArrivalStatusRequestError` instead of being reported as a terminal `error`; and THOR/Maya node-only completion now reads THORNode's `planned_out_txs[].refund` flag to report `success`/`refunded` when available, instead of always forcing an artificial `pending` state.
