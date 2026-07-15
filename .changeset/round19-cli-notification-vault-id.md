---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Fix the CLI agent push-notification listener to register/connect with the canonical hashed notification vault id instead of the raw ECDSA pubkey, restoring parity with SDK secure-vault notification delivery.
