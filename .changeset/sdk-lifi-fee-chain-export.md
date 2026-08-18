---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export the canonical LI.FI swap-fee chain resolver from the root and React Native SDK entrypoints so consumers stop deep-importing or reimplementing the fee-chain mapping logic.