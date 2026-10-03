---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
---

fix(swapkit): accept ERC-20 deposit transfers on NEAR-Intents routes

An ERC-20 sold through SwapKit's NEAR-Intents provider (`txHint:
'simpleTransfer'`) is a `transfer(targetAddress, amount)` call on the token, so
`tx.to` is the token rather than `targetAddress` and every such route (USDT/USDC
to SOL, ...) was refused. That shape is now accepted only when it is exactly a
`transfer` of the sold amount to the screened `targetAddress` with no native
value; the deposit recipient is Blockaid-screened too, and no approve leg is
built because a direct transfer spends no allowance. Its gas limit is its own
simulation raised to the per-chain ERC-20 transfer floor; the route's gas
figure no longer inflates it.

Co-signers enforce the same binding from the payload alone: a SwapKit swap
addressed to the sold token, or carrying any `transfer` call, must be exactly
`transfer(recipient, fromAmount)` on the sold token with no native value, and
the decoded recipient must get a benign Blockaid verdict before signing.
