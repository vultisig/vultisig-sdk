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

`DeliverMin` restores a floor, so a partial payment carrying one is forwarded
unchanged. One without it is refused: there is nothing left binding the
outcome, and no reviewer could have seen what they were approving. `Flags` that
cannot be read as a uint32 — the `{ tfPartialPayment: true }` object form some
client libraries accept — are refused for the same reason, since they may carry
the very bit being checked.
