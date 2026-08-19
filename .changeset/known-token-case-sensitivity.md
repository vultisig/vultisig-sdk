---
"@vultisig/sdk": patch
---

Stop lowercasing non-EVM known-token IDs (Solana, XRPL, etc.) before index lookup so case-sensitive canonical IDs cannot false-hit on an unrelated token; EVM lookup remains case-insensitive.
