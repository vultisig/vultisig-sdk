---
'@vultisig/sdk': patch
---

Export the EVM priority-fee floor/ceiling tables (`evmPriorityFeeFloorWeiByChain`, `evmPriorityFeeCeilingWeiByChain`) from the root and React Native entry points, so downstream consumers can read the canonical per-chain gas-price floors instead of hand-maintaining their own copies.
