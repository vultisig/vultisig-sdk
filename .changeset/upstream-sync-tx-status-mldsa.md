---
"@vultisig/sdk": minor
---

Sync upstream core/lib changes and add new SDK features

- **`getTxStatus()`**: New method on VaultBase to check transaction confirmation status across all supported chains. Emits `transactionConfirmed` and `transactionFailed` events. Supports EVM, UTXO, Cosmos, Solana, THORChain, and more.
- **ML-DSA (post-quantum) WASM support**: Added `@lib/mldsa` package and integrated ML-DSA WASM initialization across all platforms (browser, Node.js, Electron, Chrome extension).
- **Upstream sync**: Core/lib updates including Cosmos fee resolver improvements, Solana signing fixes, keygen step updates, and protobuf type regeneration.
