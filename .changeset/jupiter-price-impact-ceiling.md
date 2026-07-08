---
'@vultisig/sdk': patch
---

fix(swap): enforce a 10% price-impact ceiling on both Jupiter swap-build paths (SOL-02). A thin-pool / sandwich-bait Jupiter quote at 50-90% price impact previously built a fully signable, MPC-ready transaction with zero protection. Both `getJupiterSwapQuote` (core) and `buildJupiterSwapTx` (SDK) now refuse to build above the ceiling, matching the guard already enforced on the production agent path.
