---
"@vultisig/sdk": patch
---

fix(cardano): paginate `address_assets` so NFT-heavy wallets aren't truncated. A single unbounded Koios query capped at 1000 rows, dropping tokens past 1000 in both discovery and per-token balance; it now follows the offset/limit pages.
