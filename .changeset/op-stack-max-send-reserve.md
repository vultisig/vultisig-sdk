---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Reserve the OP-stack balance-check surcharges in the EVM fee amount, so a native max send on Optimism, Base, Blast or Mantle stays affordable at broadcast. op-geth requires `value + gasLimit * maxFeePerGas + l1Cost + operatorCost`, and an amount that left only the gas term behind was rejected by exactly the difference — after the keysign ceremony had already run. Both oracle reads fail open, so a chain whose oracle is unreachable or predates a term behaves exactly as before.
