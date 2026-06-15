---
"@vultisig/core-chain": patch
"@vultisig/sdk": patch
---

Add canonical Circle USDC on Base (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) to the known-token registry. It was the only major-EVM canonical USDC missing, so swaps to Base USDC resolved via the coingecko source and the app flagged the canonical stablecoin as "unverified token". Now it resolves as a known token (verified).
