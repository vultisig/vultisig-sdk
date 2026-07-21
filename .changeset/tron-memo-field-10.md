---
'@vultisig/sdk': patch
---

Fix the hand-rolled RN Tron transaction builder writing the transfer memo into protobuf field 12 (`scripts`, deprecated) instead of field 10 (`data`, the real Tron memo field). A TRC-20/TRX send carrying an exchange deposit tag or a THORChain swap memo previously broadcast with an empty `data` field on-chain. `buildTronSendTx`/`buildTrc20TransferTx` now write the memo to field 10 (and re-order `raw_data` field emission to match Tron's canonical ascending field order), matching the WalletCore keysign path exactly. Added a WalletCore cross-check test so the RN builder can never silently diverge from WalletCore's own encoding again.
