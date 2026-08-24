---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Preserve optional `priceProviderId` on `discoverTokens()` results so downstream consumers can price newly discovered tokens without app-local metadata backfills.
