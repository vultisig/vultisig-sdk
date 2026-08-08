---
'@vultisig/sdk': patch
---

Clamp non-zero sub-display EVM gas prices in `compareCosts()` instead of rounding them down to `0 gwei` / zero native cost. This reuses the same display-floor behavior as `evmGasPrice()`, so very cheap L2s no longer look free when `eth_gasPrice` returns a real but tiny non-zero wei value.
