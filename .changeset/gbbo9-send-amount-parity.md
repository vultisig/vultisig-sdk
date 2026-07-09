---
'@vultisig/sdk': patch
---

fix(vault): route the send-path amount parser through `toChainAmount` for swap-path parity (gbbo9)

`VaultBase.parseAmount` (the `send`/`transfer` amount converter) used `toBaseUnits` (pure string arithmetic, truncates excess fraction digits, rejects scientific notation), while the swap path (`validateHumanSwapAmount`, `SwapService`) used `toChainAmount` (viem `parseUnits`, rounds excess digits, expands scientific notation). Both were lossless/fund-safe — max divergence is 1 base-unit of dust on excess fraction digits — but the two paths used different converters for identical human-amount → base-unit semantics. `parseAmount` now shares the swap path's `toChainAmount`, so both paths behave identically. Two intended, safe behavior changes fall out: excess-fraction amounts (e.g. `0.123456789` at 8 decimals) now round instead of truncate (1-unit dust), and scientific-notation amounts (e.g. `1e18`) are now accepted on the send path instead of rejected. Error-throwing behavior, messages, and the `<= 0n` validation are unchanged.
