---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

For EVM swap providers that legitimately distinguish the allowance executor
from the swap router, use the quote's approval address for SDK allowance checks
and approval payloads while retaining the router as the signed destination.
