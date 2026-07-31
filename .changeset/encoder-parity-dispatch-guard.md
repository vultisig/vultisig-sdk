---
'@vultisig/sdk': patch
---

Fail closed before TON fast-sign dispatch unless the SDK independently derives and matches the WalletCore pre-signing hash, and align TRC-20 raw protobuf bytes with WalletCore's proto3 default-field encoding.
