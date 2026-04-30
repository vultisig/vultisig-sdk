---
'@vultisig/core-chain': patch
---

`@vultisig/core-chain`: lift the qbtc protobuf wire-format helpers to a shared `chains/cosmos/protoEncoding` module (extending it with lower-level `varintBig` / `protoField` primitives that don't apply proto3 default-elision, alongside the existing default-eliding `protoVarint` / `protoBytes` / `protoString`), and add `chains/cosmos/terraClassicTax` with LCD fetchers (`getTerraClassicTaxRate`, `getTerraClassicTaxCap`) plus the pure `applyTerraClassicTax` helper for the cosmos-sdk Dec-fixed-point math. Tax rate is `0` on the live chain today (governance-paused) but the helpers are ready for callers that need to be correct when it reactivates. The previous `qbtc/protoEncoding` package export is replaced by `cosmos/protoEncoding`; the qbtc consumers were updated in lockstep, no behavior change.
