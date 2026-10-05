---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Fix RUJI Trade (RUNE ↔ bRUNE) swaps to send FIN's untagged swap request with `min_return` and `to` directly under `swap`. The previous `{ swap: { min: { ... } } }` wrapper decoded on-chain as an unguarded Yolo swap, dropping the slippage guard and the recipient. Keysign now requires the flat form, and also rejects a `min_return` outside Uint128, which FIN would likewise treat as Yolo.
