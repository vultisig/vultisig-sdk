---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Preserve every movement in a Blockaid Sui simulation before classifying the approval headline (vultisig-sdk#2423). Diffs are now netted by coin type, so native SUI is no longer discarded from a three-diff response by position, and a transaction with three or more net movements — such as a token-to-token swap with its separate SUI gas — declines the headline instead of summarising part of it. Ordinary SUI sends, SUI-funded swaps and swaps into SUI keep their headline.
