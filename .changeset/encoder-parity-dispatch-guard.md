---
'@vultisig/sdk': major
---

Return WalletCore parity input from TON builders and fail closed before TON fast-sign dispatch unless its independently derived signing hash matches. `walletCoreTxInputData` is now required for every `chain === 'ton'` call to `fastVaultSign` / `schnorrSign` — the parity check was previously skipped whenever a caller omitted it, which meant it never protected real TON sends. Callers on `buildTonSendTx` / `buildTonJettonTransferTx` must thread the builder's `walletCoreTxInputData` through to the signer; `buildTonTxFromSigningPayload` (prebuilt/yield.xyz payloads) cannot supply one yet and will now be rejected at dispatch instead of signing unchecked. `FastVaultSignOptions.chain` is also now required (was optional) and throws `InvalidConfig` when omitted. Also align TRC-20 raw protobuf bytes with WalletCore's proto3 default-field encoding.
