---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

fix(ripple): state TrustSet on the wire so it co-signs with iOS

An XRPL trust-line activation originated here could not be co-signed by an iOS
device: the ceremony diverged and never completed. No funds moved, but the trust
line could not be opened at all in a mixed committee.

A non-native Ripple coin is ambiguous on its own — the same `(currency, issuer)`
pair means either "open a trust line for this token" (TrustSet, where the keysign
amount is the trust-line LIMIT) or "send this token" (Payment with a
CurrencyAmount) — and the two sign different bytes. commondata already carries
the discriminator that resolves it, but the generated protos here were stale, so
`RippleSpecific.transaction_type` never reached the wire and each platform fell
back to its own default: this SDK always read a TrustSet, iOS read a Payment.

Regenerates `blockchain_specific_pb.ts` from commondata (adding
`RippleSpecific.transaction_type` and `TRANSACTION_TYPE_RIPPLE_TRUST_SET`), sets
the field when building a TrustSet, and prefers it when signing.

The coin-shape inference is kept as the fallback, deliberately: clients shipped
before this field infer TrustSet from a non-native coin alone, so honouring that
keeps a TrustSet byte-identical across a mixed-version committee. Native XRP
payloads and verbatim `signRipple` dApp transactions leave the field unset, so
their signed bytes are unchanged.
