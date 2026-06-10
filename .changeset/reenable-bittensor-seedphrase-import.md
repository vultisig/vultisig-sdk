---
'@vultisig/sdk': patch
---

Re-enable Bittensor for seed-phrase import by removing it from `SEEDPHRASE_IMPORT_UNSUPPORTED_CHAINS`. The server-side curve misclassification that caused Bittensor imports to hang (vultiserver classified it as ECDSA and ran DKLS while clients run Schnorr) is fixed in vultiserver#157.

⚠️ **Deployment dependency:** this change depends on the server-side fix. vultiserver#157 must be deployed to **production** before consumers upgrade to this SDK. If the server fix is not live, enabling Bittensor seed-phrase imports will hang or fail, exactly as before. Do not consume this release until the server deploy is confirmed.
