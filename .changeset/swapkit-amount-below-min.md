---
'@vultisig/core-chain': patch
---

fix(swap/swapkit): reclassify noRoutesFound as "amount too small" when the pair is structurally supported - cross-checks the cached /providers snapshot so low-amount swaps (e.g. BCH->ETH) surface an actionable message instead of a misleading "no route" error
