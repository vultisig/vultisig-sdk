---
"@vultisig/core-chain": patch
"@vultisig/core-mpc": patch
---

Fix Cosmos transaction status receipts when the indexer reports `gasWanted` as zero: derive the gas denominator from decoded `fee.gasLimit` or `gasUsed`, sum native fee coins case-insensitively, and clamp proportional fees to the max fee. Aligns THORChain swap success fee display with co-signed and cross-client flows (see vultisig-windows#3501).
