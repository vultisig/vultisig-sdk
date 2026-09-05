---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': patch
'@vultisig/sdk': minor
'@vultisig/cli': patch
---

Fix TRON transaction lifecycle safety across fee preparation, status polling, and broadcast. Native TRX bandwidth estimates now measure the WalletCore-serialized signed transaction including memo bytes, default transaction times use the fetched block timestamp, expired raw transactions terminate polling, and successful broadcasts must return the deterministic local transaction hash.
