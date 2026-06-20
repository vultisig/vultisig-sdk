---
"@vultisig/core-mpc": patch
"@vultisig/sdk": patch
---

fix(qbtc): set QBTC Cosmos SDK chain ID to `qbtc` (was `qbtc-testnet`)

The SignDoc built by `QBTCHelper` now uses `qbtc` as the chain ID so signed
transactions match the live QBTC chain. Patch-bumps `@vultisig/sdk` to rebundle.
