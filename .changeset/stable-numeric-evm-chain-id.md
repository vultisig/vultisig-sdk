---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Export `getEvmNumericChainId` from the SDK root and React Native public entries. The accessor is derived from the canonical EVM chain registry, and the React Native transaction builder now consumes it instead of maintaining a duplicate numeric chain-id table.
