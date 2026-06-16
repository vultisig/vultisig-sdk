---
'@vultisig/core-chain': patch
---

Use a distinct provider for Kujira's LCD fallback so primary (polkachu) and fallback (rest.cosmos.directory) are independent - restoring real redundancy if polkachu degrades.
