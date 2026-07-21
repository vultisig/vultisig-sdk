---
'@vultisig/sdk': patch
---

Centralize native-swap chain-id lookups behind a canonical `getNativeSwapChainId` accessor, removing duplicated nullable-map wrappers from the SDK broadcast guard and native-swap core helpers.
