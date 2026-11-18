---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

fix(core-chain): use xrpscan's `/tx/` path for XRP transaction explorer links (was `/transaction/`, which xrpscan does not route)
