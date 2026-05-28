---
'@vultisig/core-chain': patch
---

add 30s per-fetcher timeout guard to findSwapQuote — a hanging provider no longer stalls the whole allSettled fan-out
