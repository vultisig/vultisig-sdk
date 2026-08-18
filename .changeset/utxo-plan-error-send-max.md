---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Inspect WalletCore UTXO `plan.error` and map terminal failures to an actionable SDK error instead of leaking `Error_not_enough_utxos`. Thread optional `sendMaxAmount` (default false) through chain-specific + send payload builders so callers can plan a sweep up front. Empty near-max plans still go to `refineKeysignUtxo`.
