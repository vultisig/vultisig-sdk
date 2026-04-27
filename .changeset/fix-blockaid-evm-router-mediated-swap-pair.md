---
'@vultisig/core-chain': patch
---

fix(security/blockaid): pair swap diffs across all asset diffs in EVM simulations

`parseBlockaidEvmSimulation` previously destructured only `assetDiffs[0]` and `assetDiffs[1]`. For router-mediated flows like `permitAndCall`, Blockaid returns three diffs with the user's `in` side at `assetDiffs[2]` and an empty intermediate leg at `assetDiffs[1]`, causing the parser to bail and the simulation hero to render nothing. The parser now scans all diffs for the user-side `out` and `in` legs (preferring an in-asset different from the out-asset), matching the iOS `BlockaidSimulationParser` behaviour.
