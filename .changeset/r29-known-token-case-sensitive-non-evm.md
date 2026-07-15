---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Keep known-token lookup case-insensitive only for EVM contract addresses, and require exact canonical ids for non-EVM assets like Solana mints and XRPL issued-currency token ids.
