---
'@vultisig/sdk': minor
---

`BalanceService.getBalances` and `VaultBase.balances` accept an optional `onChainError(chain, error)` callback, invoked once per chain whose balance fetch throws.

Additive and non-breaking: every existing caller is unaffected and the fan-out still fails open exactly as before. It exists because a swallowed per-chain failure was previously invisible to callers - `getBalances` returns a partial record plus a `console.warn` the caller cannot observe, and the absence of a chain in the result is indistinguishable from a chain that legitimately holds nothing. Callers that want to report partial failure (the CLI's `balance` sweep) now can.
