---
"@vultisig/core-chain": patch
"@vultisig/core-mpc": patch
"@vultisig/sdk": patch
---

refactor(cardano): attach CIP-20 memo via WalletCore native auxiliary_data

Bumps `@trustwallet/wallet-core` to `4.7.0`, which adds the Cardano
`SigningInput.auxiliary_data` field. The Cardano memo path now hands the
CIP-20 CBOR straight to WalletCore, which commits its Blake2b-256 hash into
tx body key 7 and embeds the bytes in the signed transaction — replacing the
client-side body patching and re-hashing in TypeScript. The chain-specific
fee estimator prices the WalletCore body as-is (it already carries key 7),
and the now-unused `patchTxBodyWithAuxHash` helper is removed.
