---
"@vultisig/core-chain": patch
"@vultisig/sdk": patch
---

fix(terra-classic): align send gas limit with iOS/Android for cross-device co-signing

Corrects the Terra Classic send gas limit in `cosmosGasLimitRecord` so it matches
the values used by the iOS and Android clients. When co-signing across devices, a
mismatched gas limit produces a different transaction hash and the signing session
fails; aligning the record keeps the payload identical across platforms.
