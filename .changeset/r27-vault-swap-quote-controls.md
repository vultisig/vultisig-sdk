---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Forward `recipient`, `slippageTolerance`, and `excludeProviders` through `vault.swap()` and make the CLI `swap --slippage` flag reach the SDK quote builder instead of being silently dropped.
