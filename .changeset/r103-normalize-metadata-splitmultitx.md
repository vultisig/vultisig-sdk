---
'@vultisig/sdk': patch
---

Preserve top-level routing metadata when normalizing flat tx payloads, and carry `chain` / `from_chain` / `to_chain` args onto split multi-leg transactions. This keeps `normalizeTx()` and `splitMultiTx()` consistent for downstream app/backend consumers that rely on the canonical SDK envelope contract.
