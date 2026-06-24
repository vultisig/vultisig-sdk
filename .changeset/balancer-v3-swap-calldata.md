---
'@vultisig/sdk': minor
---

Add `sdk.defi.balancer.buildBalancerV3SwapCalldata` — a pure, unsigned Balancer v3 swap calldata builder under the new `sdk.defi.*` surface. It thinly wraps `@balancer/sdk` (viem-only, RN-safe) to encode the v3 BatchRouter `swapExactIn`/`swapExactOut` tx from an off-chain SOR quote, with consumer-injectable `userData` (default `0x`). No signing, no broadcast.
