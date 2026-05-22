---
"@vultisig/core-chain": patch
---

fix(swap/swapkit): include UTXO, Cosmos, and THOR chains as SwapKit source chains

`SwapKitSourceChain` and `SwapKitEnabledChain` are now both 22 chains (was 8 and 21
respectively). The type distinction is preserved via separate consts to allow future
narrowing; current runtime behaviour is identical for source and destination.

Chains added to `SwapKitSourceChain`: Bitcoin, BitcoinCash, Cardano, Cosmos, Dash,
Dogecoin, Kujira, Litecoin, MayaChain, Ripple, Sui, THORChain, Ton, Tron, Zcash.
