---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
---

EVM fee quotes now size the gas reserve from the transaction itself instead of a flat 600k floor. An aggregator swap is signed with the larger of the route's own gas and 1.5x its simulation (1.5x the 600k default when it cannot be simulated, e.g. a token route quoted before its allowance exists); a THORChain or Maya swap deposit (any transaction carrying the native swap payload) takes a fixed 120k; a plain transfer, including a memo-carrying vault deposit that carries no swap payload, takes its simulation raised to a per-chain floor with no inflation; a dApp or other contract call keeps 1.5x headroom over its simulation. Base-fee headroom drops from 50% to 20% (32% for swaps), legacy-priced chains (BSC) are priced from `eth_gasPrice` with no tip, and the tip is the highest recent 5th-percentile reward from `eth_feeHistory`, capped at the gas price, with per-chain floors (1 gwei on tip-auction chains, 30 gwei on Polygon, 20 wei on OP-stack rollups) and a zero tip on Arbitrum, Mantle and Robinhood.

`getEvmFeeQuote`'s `minimumGasLimit` now only raises the value that stands in for a failed simulation and never a successful estimate. `getEvmTransferGasLimit`, `getEvmContractCallGasLimit` and `evmRouterDepositGasLimit` are exported from `@vultisig/core-chain/tx/fee/evm/evmGasLimit`, and `getEvmGasPrice` from `@vultisig/core-chain/tx/fee/evm/gasPrice`.
