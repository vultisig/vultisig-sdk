---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Fix the React Native LiFi quote override applying a flat 1% slippage and discarding the caller's slippage. `platforms/react-native/overrides/getLifiSwapQuote.ts` hardcoded `slippage: 0.01` and had no `slippage`/`ticker` input, so on RN (most users) every LiFi quote used 1% — stable pairs that get the 0.3% tier on the core path got 1% (a wider MEV/loss surface), and an explicit tight-tolerance request was silently dropped (LiFi bakes `minAmountOut` from it). The tiered/override resolution (`resolveLifiSlippage`) is now extracted to a shared `lifi/api/lifiSlippage` module that both the core path and the RN override use, so they resolve slippage identically.
