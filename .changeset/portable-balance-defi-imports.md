---
'@vultisig/sdk': patch
'@vultisig/core-chain': patch
---

Build dedicated browser, worker, and React Native balance and DeFi subpaths that initialize without the root SDK or consumer Buffer shims. Keep balance and StakeKit request deadlines active through body consumption without requiring AbortSignal.timeout, preserving retries and cancellation. Separate Solana and Polkadot endpoint constants from client initialization.
