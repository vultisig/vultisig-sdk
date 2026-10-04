---
'@vultisig/core-mpc': patch
'@vultisig/sdk': patch
---

Co-sign SwapKit swaps that carry a pre-built Cardano transaction (`tx_type = "CARDANO_PREBUILT"`). SwapKit builds the whole transaction for this route and the initiator relays it in `tx_payload` as the CBOR envelope `[body, witness_set, is_valid, aux_data]`, but nothing handled that type: a co-signer rebuilt a native ADA send from `toAddress` / `toAmount` / `utxoInfo`, signed a different body than iOS and Android, and the keysign never converged. The envelope is now the signing input — the digest is blake2b-256 of its body bytes verbatim, and the signed transaction is the same envelope with the vault's vkey witness in place of item 1.

No Verify screen shows that body, so it is validated against the vault's own key before any hash is produced. It must be a plain payment (only inputs, outputs, fee, ttl, validity start, aux-data hash and network id) in which every output pays the vault's enterprise address except a single ADA-only deposit of at most `from_amount`, with a fee of at most 2 ADA. The swap's source asset must be ADA, so that `from_amount` is a lovelace amount.
