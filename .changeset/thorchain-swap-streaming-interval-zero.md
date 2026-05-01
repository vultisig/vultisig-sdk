---
'@vultisig/core-chain': patch
---

fix(chain): THORChain native swap `streaming_interval` 0 (Rapid Swaps)

THORChain can serve swaps in a single block and auto-stream when needed.
Using `1` forced streaming; `0` lets the protocol choose. MayaChain
unchanged (`3`).

Refs: https://github.com/vultisig/vultisig-windows/issues/3613
