---
"@vultisig/sdk": patch
"@vultisig/cli": patch
---

Tokens without a price source are no longer valued at 0: the SDK reports them as failures (new `getValuesDetailed`), and `vultisig portfolio` lists them with `value: null`, records each in `failures` with its token id, and sums only priced rows into the total.

`vault.portfolio()` now returns partial results with an additive `failures` list instead of rejecting when one asset has no price source.
