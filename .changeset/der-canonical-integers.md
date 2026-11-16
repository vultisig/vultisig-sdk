---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
'@vultisig/rujira': patch
---

ECDSA DER signatures are now always canonical. When `r` or `s` started with a zero byte, the encoder kept that byte, and UTXO chains (BTC, LTC, DOGE, BCH, DASH, ZEC) rejected the transaction with `Non-canonical DER signature`. This hit about 1 in 100 signatures, so sends with many inputs failed most often. The encoder now drops leading zero bytes, as DER requires. The SDK and Rujira readers that turn DER back into `r` and `s` now accept these shorter signatures.
