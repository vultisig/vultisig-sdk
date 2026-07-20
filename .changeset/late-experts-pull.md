---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export the canonical prep constants from `@vultisig/sdk` and `@vultisig/sdk/react-native` so consumers can import `TRC20_TRANSFER_SELECTOR`, `SUI_NATIVE_COIN_TYPE`, and `CONSOLIDATE_CHAINS` from the public SDK surfaces instead of copying local literals.