---
'@vultisig/rujira': patch
---

Fix FIN swap messages and encoded memos to place `min_return` and `to` directly under `swap`, matching the contract's untagged request format and preserving minimum output and recipient.
