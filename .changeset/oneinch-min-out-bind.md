---
'@vultisig/core-chain': patch
---

Refuse 1inch quotes whose known-selector calldata encodes a `minReturn` below `dstAmount * (1 - slippage)`. Unknown selectors stay signable so a router upgrade does not brick honest swaps.
