---
'@vultisig/sdk': minor
---

Close five holes in the published surface. `computeMaxSendFromBalance` (and its params type) now ships alongside its already-public sibling `getMaxSendAmountFromKeys`; `ChainDiscoveryAggregate` is exported from the seedphrase barrel even though it is already the return type of a public `Vultisig` method; `prepareSeedphraseImportPrelude` — the step both seedphrase-import services run first — is reachable; the canonical THOR/Maya native-swap metadata (`nativeSwapChains`, `nativeSwapEnabledChainsRecord`, `nativeSwapChainIds`, `getNativeSwapChainId`, `getNativeSwapChainIdFromDenomPrefix`) is exported from the root and React Native entries; and the RN entry gains `getEvmRpcUrl`, which it was missing while exporting its two siblings.
