---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Fix `formatBalance`/`formatBigintAmount` computing the display divisor via `BigInt(10 ** decimals)` — a float64 power that's only exact up to decimals=22, silently corrupting balance display for higher-decimal assets. Both now delegate to the pure-bigint `fromChainAmountExact`, which is also exported from the root `@vultisig/sdk` entrypoint alongside `getBlockExplorerUrl`.
