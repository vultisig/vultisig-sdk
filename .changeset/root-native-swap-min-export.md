---
'@vultisig/sdk': patch
---

Re-export the canonical native-swap minimum helper family (`getNativeSwapMinAmountIn`, `NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER`, `NativeSwapMinAmountIn`) and the Sui/UTXO-consolidate prep companion types (`PrepareSuiTokenTransferFromKeysParams`, `ConsolidateChain`, `ConsolidateUtxo`, `PrepareUtxoConsolidateResult`, `PrepareUtxoConsolidateTxFromKeysParams`) from the root `@vultisig/sdk` entry. These already existed in the tools barrel; root-package consumers previously had no way to import them without reaching into an internal path.
