---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

fix(swap): proactively detect below-minimum native swaps (#604)

Small cross-chain swaps below the economic minimum (e.g. ETH→BTC ~$2.81) no longer surface a misleading generic "No swap route found" error. `findSwapQuote` now computes the THORChain minimum up front from the destination chain's `outbound_fee` and spot pool prices, and surfaces an actionable `AmountBelowMinimum` error with the concrete threshold ("Minimum is ~0.012 ETH. Please increase the amount.") instead of relying on brittle provider error-string matching.

- New exported helper `getNativeSwapMinAmountIn` (and `NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER`) so consumers can show the minimum proactively as the user types.
- The computed minimum is now `max(outbound-fee minimum, source dust threshold)` — THORChain rejects an input below the source chain's `dust_threshold` ("amount less than dust threshold") before economics apply (e.g. DOGE's ~1 DOGE floor), so the threshold is included alongside the outbound-fee economics. The result exposes `dustThresholdBaseUnit` and `binding: 'outbound' | 'dust'` for diagnostics.
- Eager short-circuit only when a native protocol is the sole route family; multi-provider pairs still query every provider so an aggregator with a lower minimum is never blocked.
- The generic all-fail path now logs raw provider error messages so future sub-minimum wordings become data-driven instead of guessed.
