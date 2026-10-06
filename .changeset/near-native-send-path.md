---
'@vultisig/core-chain': minor
'@vultisig/core-mpc': minor
'@vultisig/sdk': minor
---

Add native NEAR: implicit-account addresses and the account-ID grammar, balance, preparation that freezes the access-key nonce, final block hash and gas reservation, fee and MAX (balance less the gas and storage reserves), signing, a locally derived transaction hash, broadcast bound to it, and finality-checked status. NEAR-source SwapKit swaps sign the NEAR-Intents deposit as a plain transfer. An unaffordable NEAR send or swap fails with the `not-enough-funds` shortfall, and a missing named receiver with `near-destination-not-found`. The all-zero implicit account is refused as a destination, and the address-format gate validates NEAR account IDs. NEAR is not a default or seedphrase-import chain yet, and NEP-141 tokens are unsupported.
