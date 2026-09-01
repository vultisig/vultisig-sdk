---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

fix(ton): cross-check SwapKit's `tx[]` transfer against the deposit address and amount it also returns

A SwapKit `/v3/swap` response states the deposit destination in up to three independent fields — `targetAddress`, `depositAddress`, and the `tx[]` transfer array — and its size in two (`depositAmount`, `tx[0].amount`). The transfer builder took the first field that was present and never looked at the rest, so a response whose halves diverged (provider bug, API change, tampered payload) signed whichever field happened to win the precedence order while the others named a different recipient or a different size. Nothing downstream could tell.

`buildTransferTx` now refuses a response that disagrees with itself, on either the destination or the amount, instead of resolving the ambiguity by precedence. It also rejects a multi-entry `tx[]` rather than silently signing only the first transfer and under-funding the swap.

Destinations are compared per chain: TON spells one account as `EQ…`, `UQ…` or raw `workchain:hex`, so the new `areEqualTonAddresses` helper compares parsed accounts there, while every other transfer chain stays byte-for-byte (base58 is case-sensitive — normalizing case away would let two different addresses pass as one).
