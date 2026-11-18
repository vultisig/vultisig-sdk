---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

ECDSA DER signatures are now always canonical. When `r` or `s` started with a zero byte, the encoder kept that byte, and UTXO chains (BTC, LTC, DOGE, BCH, DASH, ZEC) rejected the transaction with `Non-canonical DER signature`. This hit about 1 in 100 signatures, so sends with many inputs failed most often. The encoder now drops leading zero bytes, as DER requires. `vault.sign()` results with a short `r` or `s` are padded back to 32 bytes before broadcast.
