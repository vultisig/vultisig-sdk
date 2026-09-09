---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

Blockaid now covers Robinhood chain (4663) as `robinhood`. Transaction simulation and validation run for Robinhood dApp requests and swaps, so a Uniswap swap on Robinhood shows its balance changes on the verify screen instead of nothing. Because SwapKit's EVM source eligibility keys off Blockaid coverage, Robinhood also becomes a SwapKit source chain, with the returned router screened through the Blockaid address scan like every other covered EVM chain.
