---
'@vultisig/core-chain': patch
---

Fix broken Hyperliquid block-explorer links by pointing them at hypurrscan's `/evm/` section (`https://hypurrscan.io/evm/tx/<hash>` and `/evm/address/<addr>`). The bare `/tx/` path returned a hypurrscan server error.
