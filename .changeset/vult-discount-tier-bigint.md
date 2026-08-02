---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Compare VULT discount tier balances in bigint base units instead of float64.
`100000n * 10n**18n` is not representable in float64 (`Number` round-trips it
to 99999.99999999999), so a wallet holding exactly 100,000 VULT — the diamond
minimum — was demoted to platinum and paid a 25 bps affiliate fee instead of
15 on every swap. The float rounding also swallowed one-base-unit differences
around every tier boundary. Comparisons now stay exact via `toChainAmount`
(vultisig-sdk#1677).
