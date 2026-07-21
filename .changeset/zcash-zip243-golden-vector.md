---
'@vultisig/sdk': patch
---

Export `getSighashZcash` from `@vultisig/sdk`'s UTXO chain surface (alongside the existing `getSighashBIP143` / `getSighashLegacy`) so the low-level ZIP-243 Zcash sighash can be golden-vector tested directly. Test-only change otherwise: adds a golden signing vector for Zcash's v4/Sapling transparent-send sighash, pinned against an independently-computed ZIP-243 reference digest, ahead of the 2026-07-28 Ironwood consensus-branch-id rotation.
