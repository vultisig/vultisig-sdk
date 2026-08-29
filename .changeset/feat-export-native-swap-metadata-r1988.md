---
'@vultisig/sdk': patch
---

Export the canonical THOR/Maya native-swap metadata (`nativeSwapChains`, `nativeSwapChainIds`, `nativeSwapEnabledChainsRecord`, `getNativeSwapChainId`, `getNativeSwapChainIdFromDenomPrefix`, and the `NativeSwapChain`/`NativeSwapChainId` types) from both the root `@vultisig/sdk` entry and `@vultisig/sdk/react-native`. The SDK already owned this data, but first-party consumers (e.g. vultiagent-app's local `thorchainDispatchValidators.ts`) had no supported way to import it and kept app-local copies of which chains route through THORChain/MayaChain and their asset-notation chain IDs.
