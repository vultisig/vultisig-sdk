---
"@vultisig/core-chain": patch
"@vultisig/sdk": patch
---

Preserve all native SOL movements before SOL/WSOL netting so transaction approval summaries cannot reverse direction by dropping a principal leg. Decline unsupported multi-asset shapes instead of assuming small native movements are fees.
