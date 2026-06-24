---
'@vultisig/sdk': minor
---

Add `sdk.swap.astroport` — `buildAstroportSwap` quotes (read-only `simulate_swap_operations`) and builds an unsigned Astroport router `wasm_execute` envelope for Terra v2 (phoenix-1) in-chain swaps. Pure-crypto: never signs or broadcasts. Ported from mcp-ts. Also exports the helpers `assembleAstroportSwap`, `classifyAstroportAsset`, `computeAstroportMinReceive` and the `ASTROPORT_ROUTER` / `TERRA_LCD` / `TERRA_CHAIN_ID` constants.
