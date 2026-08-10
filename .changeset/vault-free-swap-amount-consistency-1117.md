---
'@vultisig/sdk': patch
---

Close the residual amount-consistency gap named in #1092 (ABTS/plan 005): `prepareSwapTxFromKeys`, the vault-free (agent-reachable) swap builder, now rejects a native, EVM, or Solana swap quote whose base-unit amount doesn't match the amount the caller is signing for. `findSwapQuote` now stamps every quote with `requestedAmount`, the only reliable amount-consistency signal available for routes whose response carries no committed-input-amount field of its own.
