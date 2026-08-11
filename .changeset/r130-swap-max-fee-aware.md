---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Make `vault.swap({ amount: 'max' })` honor the SDK's fee-aware `maxSwapable` quote result for native assets and fail closed when the quote cannot compute a safe native max.
