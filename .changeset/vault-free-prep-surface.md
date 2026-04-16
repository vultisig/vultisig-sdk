---
"@vultisig/sdk": minor
---

Expose vault-free atomic prep functions: `prepareSendTxFromKeys`, `prepareSwapTxFromKeys`, `prepareContractCallTxFromKeys`, `prepareSignAminoTxFromKeys`, `prepareSignDirectTxFromKeys`, and `getMaxSendAmountFromKeys`. Each takes a `VaultIdentity` (raw public keys + identity metadata, no key shares) so MCP servers and other consumers without a full vault instance can build unsigned `KeysignPayload`s directly. Also re-exports `getCoinBalance` and `getPublicKey` as atomic helpers. `VaultBase`, `TransactionBuilder`, and `SwapService` now delegate to these helpers internally — public API unchanged.
