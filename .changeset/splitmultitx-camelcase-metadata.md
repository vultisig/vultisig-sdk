---
'@vultisig/sdk': patch
---

Preserve camelCase transaction metadata like `chainId`, `fromChain`, `toChain`, symbols, addresses, and decimals when `splitMultiTx()` expands a `transactions[]` build result into per-leg envelopes. This keeps newer SDK-native multi-leg builders from silently losing routing/display metadata that downstream app and backend consumers need.
