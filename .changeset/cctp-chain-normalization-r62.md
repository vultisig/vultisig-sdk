---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Normalize CCTP source/destination chain aliases through the SDK's canonical chain resolver so bridge and claim builders accept standard alias spellings like `base` and `arbitrum one` and reject same-chain alias pairs consistently.
