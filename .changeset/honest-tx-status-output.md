---
'@vultisig/cli': patch
---

Give `tx-status` a dedicated `INVALID_HASH` error before vault access and expose consistent CLI-facing statuses: `pending`, `not_found`, `confirmed`, and `failed`.
