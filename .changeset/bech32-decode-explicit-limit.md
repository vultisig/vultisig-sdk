---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
'@vultisig/rujira': patch
---

Pass an explicit length limit to every bech32 decode. `fromBech32` defaults the limit to `Infinity`, which `@scure/base` >= 2.3 rejects, so in apps whose lockfile resolves that version every decode threw and QBTC address validation rejected all addresses (including the vault's own). THORChain address checks in RUJI trade quotes, limit-swap memos, swap keysign builds, Cosmos governance voting, and Rujira destination validation were affected the same way.
