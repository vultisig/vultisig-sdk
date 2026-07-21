---
'@vultisig/core-mpc': patch
---

Fix Cardano send-max building an unbroadcastable zero-fee transaction. WalletCore's Cardano planner ignores `forceFee` whenever `useMaxAmount` is set (it returns the full input as the amount with fee=0), so a send-max is now built as an explicit `(totalInput - fee)` transfer with the converged fee forced and `useMaxAmount: false` - yielding a valid fee-bearing tx with the balance fully consumed (no change output).
