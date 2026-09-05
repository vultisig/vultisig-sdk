---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export `resolveTokenPriceId` from the root and React Native SDK entrypoints so first-party consumers can share the canonical non-EVM token-to-price-id resolver instead of deep-importing core internals.
