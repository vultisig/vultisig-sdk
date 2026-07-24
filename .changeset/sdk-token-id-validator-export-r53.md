---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export `isValidTokenId` from the root and React Native SDK entrypoints so consumers can validate Sui struct-tag and XRPL issued-currency token ids without reimplementing chain-specific rules.
