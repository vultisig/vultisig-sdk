---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

`getSwapArrivalStatus` now finds a THORChain or MayaChain swap that started on an EVM chain. THORNode and Midgard key a deposit by its hash without the `0x` prefix, so the prefixed hash an EVM chain returns read as `not_found` for as long as it was polled. The lookup now strips the prefix (and uppercases hex, leaving base58 signatures untouched), and the result still echoes the hash the caller passed. The deposit's own hash is also no longer mistaken for the destination while the outbound is unsent.
