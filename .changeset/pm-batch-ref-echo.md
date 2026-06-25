---
'@vultisig/cli': patch
---

Echo `pm_batch_ref` from the agent `sign_typed_data` path so Polymarket BATCH
approvals auto-submit. The multi-payload (batch) return now includes
`pm_batch_ref` alongside `pm_order_ref`, and the client-side tool dispatch echo
loop forwards the bare `pm_batch_ref` marker into the recent-action data.
Previously BATCH approvals signed but the backend never dispatched
`submit_deposit_wallet_batch` because the marker was dropped.
