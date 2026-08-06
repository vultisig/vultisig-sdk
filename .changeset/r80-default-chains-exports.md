---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export `DEFAULT_CHAINS` and `defaultChains` from the root and React Native SDK entrypoints so consumers can reuse the canonical onboarding/import default-chain set instead of maintaining local mirrors.
