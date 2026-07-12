---
'@vultisig/core-mpc': minor
'@vultisig/sdk': patch
---

Support signing dApp-supplied XRPL transactions via the new `SignRipple` keysign payload.

- `getRippleSigningInputs` signs `signData.signRipple.rawJson` verbatim, so transaction types the keysign payload cannot otherwise express — offers (DEX swaps), cross-currency payments, trust lines — round-trip. Every signer rebuilds its input from the same JSON, so each party signs identical bytes. Native XRP sends and issued-currency `TrustSet` are unchanged.
- Fail closed on rawJson `Payment` transactions: `Account`, `Destination` and `Amount` must match the reviewed keysign metadata (`coin.address`, `toAddress`, `toAmount`), so the review surface and the signed bytes cannot diverge even for same-account payments. Non-Payment types still pass on the `Account` check alone.
- `getRippleChainSpecific` now skips the base-reserve destination check when the payload has no `toAddress` (a dApp offer has none); fee and sequence come from the sender account and are unaffected.
- Regenerated the keysign protos for the `SignRipple` variant added in commondata.
