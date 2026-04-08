---
"@vultisig/sdk": patch
---

Stop generating ML-DSA during secure vault creation, join, seedphrase import, and reshare. ECDSA and EdDSA only during the ceremony, matching mobile apps; ML-DSA remains available as a separate optional step.
