---
"@vultisig/core-chain": patch
"@vultisig/sdk": patch
---

fix(solana): read Stakewiz `total_apy` for validator APY — `apy_estimate` overstated realized staking yield by ~60% (8.1% vs ~5.1%)
