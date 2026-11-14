---
"@vultisig/sdk": patch
---

Validate coin inputs at runtime in all three coin-taking entry points: send (`prepareSendTx` / `prepareSendTxFromKeys`), fee estimate (`estimateSendFee`) and swap coin resolution. Send and fee estimate require an `AccountCoin`; swap accepts an `AccountCoin` or a `SimpleCoinInput`. Unknown keys, missing or mistyped values (unknown chain, blank address/ticker, non-integer decimals, blank or zero-address `id`) now throw an `InvalidConfig` error naming the key and listing the accepted keys. `contractAddress` is accepted as an alias for `id` (a conflicting `id` throws). Previously an unknown key was ignored, so a token contract under `contractAddress` silently prepared a native send.
