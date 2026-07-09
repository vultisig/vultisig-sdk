---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Allow Solana status checks to return terminal `not_found` for unknown
signatures whose `lastValidBlockHeight` has expired.
