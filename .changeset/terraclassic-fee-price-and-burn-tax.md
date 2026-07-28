---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

fix(terraclassic): price the LUNC fee from the chain's gas price and add the burn tax explicitly

`cosmosGasRecord[TerraClassic]` was a hand-tuned flat 20 LUNC (itself already
lowered from 100 LUNC). Terra Classic's actual `uluna` gas price is 28.325
uluna/gas, so a send at the static 300k limit costs 8,497,500 uluna — the flat
constant overcharged every send by ~2.35× before any gas-limit scaling.

It was also implicitly absorbing the `x/tax` burn tax (0.5% of the transfer),
which scales with the amount while a flat constant does not. So it overcharged
small sends and under-covered anything above ~2,300 LUNC, where 0.5% outgrows
the slack.

Both halves are now explicit:

- `cosmosGasRecord[TerraClassic]` = `8_497_500n` (`300_000 × 28.325`), matching
  iOS `TerraClassicTax.ulunaBaseGas` and Android `ULUNA_BASE_GAS`. It still
  scales with a relayed `gas_limit`.
- The initiator adds `applyTerraClassicBurnTax(amount, rate)` to `gas` for
  native LUNC sends, after the gas scaling — the tax tracks the transfer
  amount, not the gas limit.

Adds `getTerraClassicBurnTaxRate`, which reads `x/tax` `burn_tax_rate` (live
0.5%) and fails closed to 0.5% on any LCD error. This is a different tax from
the existing `x/treasury` `tax_rate`, which governance has held at 0 since the
UST collapse and which exempts `uluna` — reading it for a LUNC send always
returned 0. `applyTerraClassicBurnTax` is separate from `applyTerraClassicTax`
for the same reason: the burn tax exempts nothing and is uncapped.

A 300 LUNC send at a simulated 321,979 gas limit now costs 10.620056 LUNC
(9.120056 gas + 1.5 tax) instead of 21.465267.
