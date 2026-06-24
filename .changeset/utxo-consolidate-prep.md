---
'@vultisig/sdk': minor
---

Add `sdk.prep.utxoConsolidate` (`prepareUtxoConsolidateTxFromKeys`): a pure-crypto,
vault-free prep builder that produces an UNSIGNED send-max-to-self UTXO consolidation
`KeysignPayload`. Sweeps a caller-supplied set of UTXOs into a single output back to the
same address (BTC / LTC / DOGE / BCH / DASH). No network IO, no signing, no broadcast —
`vault.sign()` stays on-device.
