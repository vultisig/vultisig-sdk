---
'@vultisig/sdk': patch
---

Re-export the canonical Cosmos memo-cap helper family (`COSMOS_MEMO_DEFAULT_MAX_BYTES`, `getCosmosMemoMaxBytes`, `getCosmosMemoMaxBytesByChainId`, `isCosmosMemoWithinCap`) from `@vultisig/sdk/react-native`. The root SDK entry already exported this family; the RN entry is a hand-curated allow-list and had omitted it, pushing mobile consumers toward local memo-cap tables.
