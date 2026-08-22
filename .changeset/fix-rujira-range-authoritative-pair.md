---
'@vultisig/rujira': major
---

`RujiraRange.buildCreatePosition()` and `buildDeposit()` now prove `pairAddress` against the authoritative FIN pair registry for the requested `(base, quote)` market before building a signable transaction, rejecting any bech32-valid-but-mismatched contract sink. Both methods are now `async` (breaking: they previously returned `RangeTransactionParams` synchronously, now return `Promise<RangeTransactionParams>`) since the proof requires a GraphQL lookup. Every other range builder (`buildWithdraw`, `buildClaim`, `buildTransfer`, `buildWithdrawAll`) is unchanged.

Previously `pairAddress` was only checked for bech32 shape, so a valid-but-wrong contract address would be trusted as the escrow sink for base/quote funds — every downstream consumer had to independently re-prove pair authenticity to stay safe.
