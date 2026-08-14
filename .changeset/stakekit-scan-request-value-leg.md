---
'@vultisig/sdk': patch
---

Fix StakeKit's top-level `scan_request` targeting the APPROVAL leg instead of the value-moving leg (e.g. deposit/withdraw) for multi-step EVM yield actions shaped like `[approve, deposit]`. Adds `scan_requests[]`, a new array aligned 1:1 with `transactions[]`, so a consumer can scan every step instead of relying on the single scalar field.
