---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Fail closed when Sui pagination reports more data without a usable cursor, preventing partial coin sets or portfolios from being returned as complete.
