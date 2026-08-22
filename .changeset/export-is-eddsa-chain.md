---
'@vultisig/sdk': patch
---

Export `getSignatureAlgorithm` and `isEddsaChain` from the root SDK entrypoint so downstream consumers (e.g. agent-backend-ts) can route ECDSA-vs-EdDSA chain gating through the SDK instead of hand-copying chain-kind sets.
