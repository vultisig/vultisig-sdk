---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

Expose canonical Cosmos native-send fee metadata so first-party consumers can stop maintaining local tables: IBC chains use their shared/default floors, MayaChain exposes its fixed fee, and THORChain remains explicitly unresolved because its fee comes from live network data.
