---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

fix(ripple): only declare genuine trust lines as TrustSet

`RippleSpecific.transaction_type` was set from the coin's shape alone, but an
issued-currency Payment has the identical shape — a non-native Ripple coin with
a `contractAddress`. So sending a token stamped that payload
`TRANSACTION_TYPE_RIPPLE_TRUST_SET`.

That is worse than the ambiguity it was meant to remove. Before the field
existed, a token send diverged: this SDK built a TrustSet, an iOS co-signer
built a Payment, and the ceremony failed without signing anything. With the
field set, every signer agrees to build a TrustSet — so the ceremony *completes*
over an operation the user never asked for, setting a trust-line limit to the
amount they meant to send. No funds move, and nothing surfaces it.

Declaring is an assertion, so it now requires more than the shape: a TrustSet is
addressed to the *issuer*, the party being trusted, while a Payment is addressed
to a recipient.

The signing fallback is deliberately left broad. Clients already released infer
TrustSet from a non-native coin alone, and honouring that inference is what keeps
a genuine TrustSet byte-identical across a mixed-version committee; narrowing it
would break MPC parity with every signer in the field. A token send therefore
returns to diverging safely rather than completing wrongly.
