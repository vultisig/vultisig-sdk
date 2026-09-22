---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Preserve all Sui simulation movements before classifying approval summaries. Native SUI is no longer discarded from three-movement transactions based on its position or assumed fee identity. Ambiguous multi-movement transactions, including token swaps with a separate SUI fee, decline the simplified headline so consumers can retain transaction details.
