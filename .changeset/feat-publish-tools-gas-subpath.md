---
'@vultisig/sdk': minor
---

Publish `@vultisig/sdk/tools/gas` as a real package subpath (`compareCosts`, `getChainGasPriceGwei`, `utxoFeeRate`, Cosmos gas-fee primitives). The gas module existed and was already reachable from the root entry, but had no export condition or bundle of its own, so a consumer wanting only the gas surface had to take the whole root import. Adds export conditions, runtime bundle, declaration bundle, and packed-consumer smoke coverage, following the same pattern already proven for `./tools/parse`, `./tools/defi`, and `./tools/bridge`.
