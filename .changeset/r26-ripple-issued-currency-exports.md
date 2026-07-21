---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Re-export XRPL issued-currency canonicals from the root and React Native SDK entrypoints so first-party consumers can reuse the SDK's token-id and currency-code helpers instead of mirroring them locally.
