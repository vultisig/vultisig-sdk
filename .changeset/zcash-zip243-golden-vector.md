---
'@vultisig/sdk': patch
---

Export `getSighashZcash` from the UTXO chain surface — including the `@vultisig/sdk/react-native` platform entry, which is the entry point that actually publishes `getSighashBIP143` / `getSighashLegacy` — so the low-level ZIP-243 Zcash sighash can be golden-vector tested directly and reached by consumers alongside its siblings. Its narrow contract (transparent-only v4/Sapling, SIGHASH_ALL, P2PKH scriptCode, count-less `outputsRaw`) is now documented at the declaration, since the primitive itself does no input validation. Test-only change otherwise: adds a golden signing vector for Zcash's v4/Sapling transparent-send sighash, pinned against an independently-computed ZIP-243 reference digest, ahead of the 2026-07-28 Ironwood consensus-branch-id rotation.
