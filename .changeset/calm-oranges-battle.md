---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Fix typed EVM transaction decoding so newer supported chain ids resolve through the canonical SDK registry instead of a stale local map.
