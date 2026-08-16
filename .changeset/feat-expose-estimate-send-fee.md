---
'@vultisig/sdk': minor
---

Expose `vault.estimateSendFee()` on the public `VaultBase` surface. `swap-types.ts` and VaultBase's own `maxSwapable` comments already instruct consumers to call it when a transfer route reports `maxSwapable: 0n`, but the implementation lives on `TransactionBuilder`, which VaultBase holds as a `protected` field - so the documented instruction was uncallable and consumers had to approximate max-send or reach into internals. Thin wrapper, same parameters as `prepareSendTx`, returns the fee in the fee coin's base units.
