---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

A SwapKit ERC-20 deposit transfer builds no approve leg and reports no approval spender: a direct `transfer` to the deposit address spends no allowance. New optional `GeneralSwapTx.evm.erc20TransferDeposit` marks such quotes.
