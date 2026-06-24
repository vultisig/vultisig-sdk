---
'@vultisig/sdk': minor
---

Add `sdk.gas.price` (`evmGasPrice`) — a read-only per-chain EVM gas-price primitive.
Fetches the current `eth_gasPrice` for any supported EVM chain via the SDK's own
per-chain viem client (no extra config, no external API) and returns
`{ chain, gasPriceWei, gasPriceGwei }`. The exact value lives in the `gasPriceWei`
`bigint` (never round-tripped through a JS number); `gasPriceGwei` is a display-only
convenience rounded to 4 decimals, with a genuinely non-zero sub-floor price clamped
UP to the smallest renderable value rather than collapsing to a misleading `0`. Fails
closed: RPC errors propagate as a thrown error, never a fabricated `0` gas price.
Also exposes the previously-internal `GasEstimationService` for vault-bound callers
that need the richer chain-specific fee shape. Ported from the mcp-ts `get_gas_price`
EVM branch (pure-crypto half only; the CoinGecko USD overlay stays an orchestration
concern).
