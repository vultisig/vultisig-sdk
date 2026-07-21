---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export Ripple destination/X-address normalization helpers from the public SDK surfaces and route the CLI send command through `@vultisig/sdk` instead of a deep core-chain import.
