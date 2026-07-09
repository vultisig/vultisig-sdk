---
'@vultisig/sdk': patch
---

fix(vault): route the send-path amount parser through `toChainAmount` for swap-path parity (gbbo9)

`VaultBase.parseAmount` (the `send`/`transfer` amount converter) used `toBaseUnits` (pure string arithmetic, truncates excess fraction digits, rejects scientific notation), while the swap path (`validateHumanSwapAmount`, `SwapService`) used `toChainAmount` (viem `parseUnits`). Both paths now share `toChainAmount` for consistent semantics.

`toChainAmount` now truncates (floors) excess fractional digits instead of rounding, so the signed amount can never exceed the stated human amount — the safe direction. Previously `parseUnits` rounded half-up, which at `decimals=0` (Cardano native assets, low-decimal tokens) caused a fractional input like `0.6` to sign `1` whole token. Scientific-notation amounts (e.g. `1e18`) are now accepted on the send path.
