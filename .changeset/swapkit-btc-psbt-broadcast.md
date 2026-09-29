---
'@vultisig/core-chain': patch
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Bitcoin PSBT keysigns (SwapKit BTC swaps and `signBitcoin` payloads) now broadcast the signed transaction and report its txid. The compiled output left `signingResultV2.encoded` and `txid` unset, and the UTXO broadcast resolver took the resulting empty bytes over the real transaction, posting `{"data":""}` to Blockchair and resolving an empty hash.
