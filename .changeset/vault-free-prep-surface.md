---
"@vultisig/sdk": minor
---

feat(sdk): vault-free prep surface + LLM/agent utilities + token-resolution primitives

- Vault-free `prepare*FromKeys` helpers that build unsigned `KeysignPayload`s from a `VaultIdentity` (raw public keys + identity metadata, no key shares): `prepareSendTxFromKeys`, `prepareSwapTxFromKeys`, `prepareContractCallTxFromKeys`, `prepareSignAminoTxFromKeys`, `prepareSignDirectTxFromKeys`, `getMaxSendAmountFromKeys`. Atomic chain helpers `getCoinBalance` and `getPublicKey` are also re-exported. `VaultBase`, `TransactionBuilder`, and `SwapService` delegate to these internally.
- LLM/agent utilities: `fiatToAmount` + `FiatToAmountError`, `normalizeChain` + `UnknownChainError`.
- Token-resolution primitives: `chainFeeCoin`, `knownTokens`, `knownTokensIndex`, `getTokenMetadata`, `getNativeSwapDecimals`, and supporting types `Coin`, `CoinKey`, `CoinMetadata`, `KnownCoin`, `KnownCoinMetadata`, `TokenMetadataResolver`, `VaultIdentity`.
