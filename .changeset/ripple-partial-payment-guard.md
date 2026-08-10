---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

fix(ripple): refuse a partial payment with no delivery floor

For a `signRipple` Payment this resolver binds the raw transaction's
`Destination` and `Amount` to the reviewed `toAddress` / `toAmount`, so the
bytes being signed match the terms someone approved. That binding assumes
`Amount` is a delivery.

`tfPartialPayment` breaks the assumption. With the flag set, `Amount` becomes a
maximum: the ledger delivers whatever the chosen path can source and records
the real figure only in the executed transaction's metadata
(`delivered_amount`). The reviewed amount is still matched byte for byte and
still describes nothing the recipient will actually receive, while the sender
can be charged the full `SendMax`. A cross-currency self-swap — the shape where
`Destination` is the sender's own address — turns an attractive receive figure
into dust for the price of the whole `SendMax`.

A `DeliverMin` restores a floor only if it actually guarantees the reviewed
amount: `DeliverMin` must be the same asset as `Amount` (native XRP, or the
same issued-currency code and issuer) and at least as much value, so a
partial payment carrying one is forwarded unchanged only when the recipient
is guaranteed to receive no less than what was reviewed. A `DeliverMin` that
is merely present and positive — but floors delivery at a fraction of
`Amount`, or in an unrelated currency — is refused: it satisfies "the field
is there" while leaving the sender able to pay the full `SendMax` for dust,
which is the exact outcome this resolver exists to prevent. `Flags` that
cannot be read as a uint32 — the `{ tfPartialPayment: true }` object form
some client libraries accept — are refused for the same reason, since they
may carry the very bit being checked.
