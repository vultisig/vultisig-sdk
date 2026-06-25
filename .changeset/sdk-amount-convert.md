---
'@vultisig/sdk': minor
---

Add `sdk.amount.convert` conversion primitives: `convertAmount` /
`toBaseUnits` / `toHumanUnits` (base-unit ↔ human-readable, precision-exact
string math) and `fiatToCrypto` / `cryptoToFiat` (fiat ↔ crypto with the
price supplied as an input), plus `AmountConvertError`. Folds the
previously-duplicated mcp-ts `convert-amount` and Go validator scale-kernel
impls into one canonical, vault-free SDK surface.
