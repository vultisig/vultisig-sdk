---
'@vultisig/sdk': patch
---

Fix `getEvmBalances()` rejecting the whole balance read when a requested ERC-20 returns its `symbol()` as a raw right-padded bytes32 instead of the canonical ABI `string` (legacy tokens like MKR, SAI). `symbol()` is now read over a raw `eth_call` and decoded as a `string` first, falling back to bytes32 decoding, matching the tolerant readers already used by `resolveContract()` and the Uniswap ERC-20 helpers.
