---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Raise Zcash memo-send fees to the ZIP-317 conventional fee at plan time. WalletCore's `zip_0317` planner flat-sizes OP_RETURN and ignores `byteFee`, so memo sends planned one logical action short and were rejected by the network; the signing-input resolver now re-plans with `zip_0317` off and bumps `byteFee` until the fee clears.
