---
'@vultisig/sdk': minor
---

Add `sdk.dex.quotes` — read-only on-chain DEX quote primitives:

- `uniswapV2Quote` / `getAmountOut`: live factory → pair → reserves reads via
  `evmCall` + canonical constant-product math (997/1000 fee, bigint).
- `balancerQuote`: canonical pool math via `@balancer-labs/balancer-maths`
  `Vault.swap()` over a caller-supplied pool state.

Both are read-only (no calldata, no signing, no broadcast) and exported from
the generic and React Native entry points.
