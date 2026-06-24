---
'@vultisig/sdk': minor
---

Add `dex.uniswap` namespace: read-only Uniswap V3 primitives — canonical
BigInt tick math (`getSqrtRatioAtTick` and bidirectional tick ↔ sqrtPriceX96 ↔
price with token-decimal adjustment, 18-sig-fig `formatPrice18`) and on-chain
pool-info (`uniswapV3PoolInfo`: factory lookup or known-pool read of
slot0/liquidity/token metadata via `evmCall`). No signing, no broadcast.
