---
"@vultisig/core-chain": patch
"@vultisig/core-mpc": patch
"@vultisig/sdk": patch
---

fix(cardano): attach and plan per-UTXO native-token data for MPC keysign parity

Adopts commondata's `UtxoInfo.cardano_tokens` across all three missing
layers, mirroring the mainnet-tested iOS implementation byte-for-byte:

- Regenerates `utxo_info_pb.ts` so `CardanoTokenAsset` /
  `UtxoInfo.cardanoTokens` exist and can be decoded off the keysign wire.
- The keysign initiator fetches Cardano UTXOs with Koios `_extended` and
  attaches per-UTXO native assets (UTXOs ordered by `(hash, index)`, assets
  by `(policyId, assetNameHex)`, hex lowercased) so co-signers see
  deterministic, token-aware payload bytes.
- The Cardano signing-inputs resolver maps `cardanoTokens` onto WalletCore
  `TxInput.token_amount` (minimal big-endian amount bytes), letting the
  planner reconcile input tokens into the change output.

Fixes MPC co-signing for any Cardano address holding native tokens:
iOS/macOS-initiated sends no longer fail keysign with a pre-image hash
mismatch, and SDK-initiated sends no longer build token-dropping bodies
that the node rejects at broadcast (Ogmios 3123 "value not conserved").
