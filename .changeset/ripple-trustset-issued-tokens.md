---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
---

feat(ripple): XRP trust-line (TrustSet) support for issued tokens

Add support for opening/modifying an XRPL trust line so a vault can hold issued
currencies (e.g. RLUSD). `getRippleSigningInputs` now emits a WalletCore
`OperationTrustSet` (LimitAmount = { currency, issuer, value }) when the keysign
coin is an issued currency, and falls through to the existing Payment path for
native XRP. New `chains/ripple/issuedCurrency` helpers encode the composite
`currency.issuer` token id, normalise human tickers to on-ledger currency codes,
format issued-currency values, and expose the 0.2 XRP owner-reserve delta
(`rippleOwnerReserveDrops`). `isValidTokenId` validates XRPL `currency.issuer`
ids.
