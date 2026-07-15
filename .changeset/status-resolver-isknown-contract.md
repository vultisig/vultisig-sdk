---
'@vultisig/core-chain': patch
---

Mark Sui, Ton, Tron, Bittensor, and QBTC status lookup misses as `isKnown:false` so broadcast verification rethrows rejected sends instead of reporting false success.
