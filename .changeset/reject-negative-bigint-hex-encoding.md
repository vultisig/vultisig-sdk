---
'@vultisig/sdk': patch
---

fix(encoding): reject negative values in hex/byte amount encoders instead of emitting garbage

`bigIntToHex`, `numberToEvenHex` and Cardano's `amountToBytes` all stringify via
`.toString(16)`. For a negative value that yields a leading-`-` string
(`"-1"`), which downstream `Buffer.from(hex, 'hex')` silently turns into empty /
garbage bytes — the MPC co-signers would then sign over an amount unrelated to
the input. These encoders only ever carry non-negative amounts / nonces /
values, so each now throws a `RangeError` on a negative input (fail closed)
rather than producing a corrupted signing payload.
