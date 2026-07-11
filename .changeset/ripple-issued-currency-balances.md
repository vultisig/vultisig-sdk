---
'@vultisig/core-chain': minor
---

Surface XRP issued-currency (trust-line) token balances.

- `getRippleAccountLines` reads an account's trust lines, following `account_lines` pagination so a large set is not truncated.
- `getRippleCoinBalance` now dispatches on the coin id: native XRP still returns the reserve-adjusted spendable balance, while an issued-currency coin returns that trust line's balance. Previously the resolver ignored the id and returned the XRP balance for *every* Ripple coin, so a token row displayed the account's XRP balance.
- `findRippleCoins` discovers held trust lines for the coin finder, so XRPL tokens appear in the asset list. Lines with a negative balance (the account is the issuer and owes the counterparty) and zero-balance lines are excluded.
- `rippleKnownIssuedTokens` (RLUSD) is now wired into `knownTokens`, so it is selectable before a trust line exists.
