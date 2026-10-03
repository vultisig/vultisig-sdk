---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
---

fix(swapkit): accept ERC-20 deposit transfers on NEAR-Intents routes

An ERC-20 sold through SwapKit's NEAR-Intents provider (`txHint:
'simpleTransfer'`) is a `transfer(targetAddress, amount)` call on the token, so
`tx.to` is the token rather than `targetAddress` and every such route (USDT/USDC
to NEAR, SOL, ...) was refused. That shape is now accepted only when it is
exactly a `transfer` of the sold amount to the screened `targetAddress` with no
native value; the deposit recipient is Blockaid-screened too, and no approve
leg is built because a direct transfer spends no allowance.
