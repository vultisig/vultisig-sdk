---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export `toChainAmount` and `ChainAmountParseError` from the root `@vultisig/sdk` entrypoint so downstream consumers can use the hardened amount parser without deep-importing core-chain internals.
