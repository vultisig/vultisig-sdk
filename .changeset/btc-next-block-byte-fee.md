---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Bitcoin byte fees now follow the projected next block instead of Blockchair's suggestion x2.5. The rate is `max(2, ceil(max(M, B) x 1.25))` sat/vB, where `M` is the median fee of the next projected block from `api.vultisig.com/mempool/v1/fees/mempool-blocks` and `B` is Blockchair's suggestion. When that route fails, times out after 5 s, or returns a median outside `(0, 5000]`, the fee stays Blockchair x2.5 as before. Litecoin, Bitcoin Cash, Dash, Dogecoin and Zcash are unchanged.
