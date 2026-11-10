---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Ethereum mainnet tips now follow the market instead of a fixed 1 gwei floor. The tip is the median of the last ten blocks' 75th-percentile rewards from `eth_feeHistory`, capped at the gas price as before, with a floor of 0.2 gwei for sends and contract calls and 0.5 gwei for swaps (aggregator swaps and THORChain/Maya router deposits). When fee history fails or carries no rewards, the tip stays on the node's suggestion with the 1 gwei floor. Base-fee headroom, the 500 gwei ceiling and every other EVM chain are unchanged. `getEvmMaxPriorityFeePerGas` returns that median without the floor on Ethereum. New exports: `getEvmSigningPriorityFee` from `tx/fee/evm/maxPriorityFeePerGas`, and `ethereumSendPriorityFeeFloor` and `ethereumSwapPriorityFeeFloor` from `tx/fee/evm/clampEvmPriorityFee`. `clampEvmPriorityFee` takes an optional floor that replaces the chain's own.
