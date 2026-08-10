---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export the canonical `clampEvmPriorityFee` helper from the root and React Native SDK entrypoints so first-party TypeScript consumers can share the SDK's EVM fee sanity ceiling instead of re-implementing it locally.
