---
'@vultisig/sdk': patch
---

fix(mpc): bound `Long.fromString` against silent 64-bit wraparound on fund-relevant amount fields

`Long.fromString` silently two's-complement-wraps a magnitude that overflows 64
bits (e.g. `2^64 -> 0`, `2^63 -> -2^63`) instead of throwing, so an amount larger
than 64 bits would be co-signed by the MPC parties as a different value than the
one the caller/UI intended. This is the same wraparound class already guarded on
the cosmos proto path by `varintBig` (and previously proven at runtime on the
osmosis `poolId=2^64 -> 0` and pendle over-`uint256` incidents).

Adds `toBoundedLong` (`@vultisig/lib-utils/bigint/toBoundedLong`), which range-checks
against the signed `[-2^63, 2^63-1]` or unsigned `[0, 2^64-1]` 64-bit range before
converting, throwing a `RangeError` on overflow. It also rejects non-decimal input
strings (`''`, `'0x10'`, whitespace-padded) that a bare `BigInt()` would otherwise
coerce — importantly `''`, which proto3 uses for an unset `toAmount` and which would
otherwise silently build a zero-amount transfer.

Wired into every fund-relevant transfer-amount `Long.fromString` call across the Sui,
Tron, Ripple, TON and Cardano keysign signing-input resolvers (including Tron's native
TRX transfers and freeze/unfreeze amounts, which previously only rejected `<= 0` after
the wrap had already happened). Signedness matches each proto field type: Sui
(`Pay`/`PaySui.amounts`) and Cardano (`Transfer.amount`) are proto `uint64`, so they
use `{ unsigned: true }` and correctly accept the legitimate `(2^63, 2^64)` range;
Tron and Ripple amounts are proto `int64`, so they use `{ unsigned: false }`.
