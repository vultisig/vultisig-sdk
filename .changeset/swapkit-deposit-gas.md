---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

A SwapKit ERC-20 deposit transfer builds no approve leg and is sized like a token send: its own simulation raised to the per-chain ERC-20 floor, never the route's gas figure. A failed simulation falls back to that floor with a console warning. New optional `GeneralSwapTx.evm.erc20TransferDeposit` marks such quotes.
