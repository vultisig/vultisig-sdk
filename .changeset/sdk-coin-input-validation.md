---
"@vultisig/sdk": patch
"@vultisig/core-chain": patch
---

Validate coin inputs at runtime in coin-taking entry points: send (`prepareSendTx` / `prepareSendTxFromKeys`), fee estimate (`estimateSendFee`) and swap coin resolution. Send and fee estimate require an `AccountCoin`; swap accepts an `AccountCoin` or a `SimpleCoinInput`. Unknown keys, missing or mistyped values (unknown chain, blank address/ticker, non-integer decimals, zero-address `id`) now throw an `InvalidConfig` error naming the key and listing the accepted keys. `contractAddress` is accepted as an alias for `id` (a conflicting `id` throws). Previously an unknown key was ignored, so a token contract under `contractAddress` silently prepared a native send.

Known metadata extras are ignored, and max-send and vault-free swap preparation are now validated too. Blank `id` and blank `contractAddress` are treated as absent (native).

Swap quote fingerprints also treat a blank `id` as native.
