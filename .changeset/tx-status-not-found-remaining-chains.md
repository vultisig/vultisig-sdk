---
'@vultisig/core-chain': patch
'@vultisig/sdk': patch
---

Transaction status lookups on Sui, TON, Ripple, Polkadot, the UTXO chains, Cardano, QBTC and Bittensor now report `not_found` when the node or indexer has no record of the hash, matching EVM, Solana and Cosmos, instead of an indefinite `pending`. A hash the node knows about, or a lookup that fails transiently, still reports `pending`.
