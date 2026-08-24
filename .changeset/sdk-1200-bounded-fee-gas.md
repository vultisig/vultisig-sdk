---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/lib-utils': patch
'@vultisig/sdk': patch
---

fix(encoding): bound TRON/Solana/Ripple fee-and-gas fields before `Long.fromString`

`Long.fromString` (and `BigInt()`) silently two's-complement-wraps an out-of-range magnitude instead of throwing (e.g. `2^64 -> 0`, `2^63 -> -2^63`). Six fee/gas sites fed by third-party gas estimation / swap-aggregator data routed raw values straight into it with no bound - a wrapped TRON `feeLimit`/`callValue`/`callTokenValue` could authorize an outsized fee burn, and a wrapped Solana priority fee or Ripple network fee misprices the transaction:

- `packages/core/mpc/keysign/signingInputs/resolvers/tron.ts` - `feeLimit` (4 sites, from `tronSpecific.gasEstimation`), `callValue`, `callTokenValue`
- `packages/core/mpc/keysign/signingInputs/resolvers/solana/send.ts` - `priorityFee`
- `packages/core/mpc/keysign/signingInputs/resolvers/ripple.ts` - `fee` (from `rippleSpecific.gas`)

New `assertBoundedInt(value, 'int64' | 'uint64')` in `@vultisig/lib-utils/bigint/assertBoundedInt` validates a decimal integer string against the proto field's declared 64-bit range and throws instead of letting the wrap happen, matching each field's real signedness (TRON's are `int64`, Solana's priority fee is `uint64`, Ripple's fee is `int64`). In-range values are unaffected - this is fail-closed only.
