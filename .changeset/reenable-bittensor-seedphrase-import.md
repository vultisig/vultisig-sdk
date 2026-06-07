---
'@vultisig/sdk': patch
---

Re-enable Bittensor for seed-phrase import. The server-side curve misclassification that caused Bittensor imports to hang (vultiserver classified it as ECDSA and ran DKLS while clients run Schnorr) is fixed (vultiserver#157), so Bittensor is removed from `SEEDPHRASE_IMPORT_UNSUPPORTED_CHAINS`.
