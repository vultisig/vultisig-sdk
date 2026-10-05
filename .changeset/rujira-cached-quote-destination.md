---
'@vultisig/rujira': patch
---

Cached swap quotes now carry the current request's destination and slippage. The quote cache is keyed by assets and amount only, so `easySwap()` / `executeSwap()` could reuse an earlier quote and route the output to that earlier request's destination.
