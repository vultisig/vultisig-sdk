---
'@vultisig/sdk': patch
---

Fix lazy `await import(...)` wrappers on the React Native entry (`getMaxSendAmountFromKeys`, `prepareContractCallTxFromKeys`, `prepareJettonTransferTxFromKeys`, `prepareSendTxFromKeys`, `prepareSignAminoTxFromKeys`, `prepareSignDirectTxFromKeys`, `prepareSwapTxFromKeys`, `prepareTrc20TransferFromKeys`, `buildSplTransfer`, `prepareUtxoConsolidateTxFromKeys`, `balancePolkadot`, `getPolkadotNativeBalance`, `getPolkadotAssetBalance`, `fiatToAmount`, `parseKeygenQR`) so their rest params are typed from `Parameters<typeof import('module')['export']>` instead of `(...args: unknown[])`. The emitted `dist/index.react-native.d.ts` now preserves the real parameter contract for RN consumers instead of erasing it.
